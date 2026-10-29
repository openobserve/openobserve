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
    v-if="open && usable"
    ref="root"
    role="group"
    :aria-label="t('assistant.helper.group')"
    data-dd-privacy="mask"
    data-test="inline-helper"
    :data-host="hostKey"
    :data-state="view.kind"
    class="border-border-default bg-surface-base flex min-w-0 shrink-0 flex-col gap-2 border-b px-2 py-2"
  >
    <div class="flex min-w-0 flex-wrap items-center gap-2" data-test="inline-helper-chips">
      <template v-for="chip in contextChips" :key="chip.kind">
        <OButton
          v-if="host.focusPicker"
          variant="outline"
          size="chip"
          :class="CHIP_CLASS"
          :data-test="`inline-helper-chip-${chip.kind}`"
          @click="host.focusPicker?.(chip.kind)"
        >
          {{ chip.text }}
        </OButton>
        <OText
          v-else
          variant="meta"
          as="span"
          class="border-border-default rounded-default min-w-0 border px-2 py-0.5 break-words"
          :data-test="`inline-helper-chip-${chip.kind}`"
        >
          {{ chip.text }}
        </OText>
      </template>
      <OButton
        variant="outline"
        size="chip"
        :class="[CHIP_CLASS, mode === 'replaceText' ? '' : 'border-border-strong']"
        :aria-pressed="mode === 'replaceText' ? undefined : mode === 'replace'"
        :disabled="mode === 'replaceText'"
        focusable-unavailable
        data-test="inline-helper-chip-mode"
        @click="toggleMode"
      >
        {{ modeText }}
      </OButton>
      <OText
        v-if="alsoSends"
        variant="meta"
        class="min-w-0 break-words"
        data-test="inline-helper-also-sends"
      >
        {{ alsoSends }}
      </OText>
      <span class="ms-auto flex items-center gap-1">
        <OButton
          variant="ghost"
          size="sm"
          :class="TOUCH_TARGET_CLASS"
          data-test="inline-helper-handoff"
          @click="handoff()"
        >
          {{ t("assistant.helper.openInChat") }}
        </OButton>
        <AssistantIconButton
          :label="t('assistant.helper.close')"
          :icon="assistantGlyph.close"
          data-test="inline-helper-close"
          @click="close"
        />
      </span>
    </div>

    <div class="flex min-w-0 items-start gap-2 max-md:flex-col max-md:items-stretch">
      <OTextarea
        ref="prompt"
        v-model="text"
        :rows="1"
        autogrow
        :max-rows="4"
        size="sm"
        width="full"
        class="min-w-0 flex-1"
        :placeholder="t('assistant.helper.placeholder')"
        :input-attrs="{ 'aria-label': t('assistant.helper.name') }"
        data-test="inline-helper-prompt"
        @keydown="onKeydown"
      />
      <OButton
        v-if="!running"
        variant="primary"
        size="sm"
        :disabled="!canSend"
        focusable-unavailable
        :class="['shrink-0 max-md:self-end', TOUCH_TARGET_CLASS]"
        data-test="inline-helper-send"
        @click="send()"
      >
        {{ t("assistant.turn.sendLabel") }}
        <OTooltip :content="sendTooltip" />
        <template v-if="sendBlocked" #unavailable-reason>{{ sendBlocked }}</template>
      </OButton>
      <OButton
        v-else
        variant="outline"
        size="sm"
        :disabled="stopping"
        :aria-label="t('assistant.helper.stopName')"
        :class="['shrink-0 max-md:self-end', TOUCH_TARGET_CLASS]"
        data-test="inline-helper-stop"
        @click="stop"
      >
        {{ t("assistant.turn.stopLabel") }}
      </OButton>
    </div>

    <div class="flex min-w-0 flex-wrap items-center gap-2" data-test="inline-helper-try">
      <OText variant="meta" as="span">{{ t("assistant.helper.try") }}</OText>
      <OButton
        v-for="(example, i) in examples"
        :key="example"
        variant="ghost"
        size="chip"
        :class="CHIP_CLASS"
        :data-test="`inline-helper-try-${i}`"
        @click="fill(example)"
      >
        {{ example }}
      </OButton>
    </div>

    <span
      class="sr-only"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-test="inline-helper-announce"
      >{{ announcement }}</span
    >
    <div class="flex min-w-0 flex-col gap-2" data-test="inline-helper-status">
      <AssistantTurnStatus
        v-if="view.kind === 'running' || view.kind === 'consent'"
        :turn="view.turn"
        :meta="view.meta"
        variant="line"
        copy="helper"
        :owned-by-this-tab="true"
        :stoppable="false"
      />
      <div
        v-else-if="line"
        class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2"
        :data-test="line.failure ? 'inline-helper-error' : 'inline-helper-line'"
        :data-kind="view.kind"
      >
        <OText variant="meta" as="p" class="min-w-0 flex-[1_1_12rem] break-words">
          {{ line.text }}
        </OText>
        <span class="flex flex-wrap items-center gap-2 max-md:w-full">
          <template v-for="action in line.actions" :key="action">
            <AssistantAskAdminPopover v-if="action === 'ask-admin'" kind="credits" :org="org">
              <template #trigger>
                <OButton
                  variant="secondary"
                  size="sm"
                  :class="TOUCH_TARGET_CLASS"
                  data-test="inline-helper-ask-admin"
                >
                  {{ t("assistant.outcome.actions.askAdmin") }}
                </OButton>
              </template>
            </AssistantAskAdminPopover>
            <span v-else-if="action === 'details'" data-test="inline-helper-details">
              <AssistantErrorDetails
                v-if="view.kind === 'failed'"
                :error="view.error"
                :at="endedAt"
                :is-admin="isAdmin"
                variant="popover"
              />
            </span>
            <OButton
              v-else
              :variant="action === 'retry' || action === 'fix' ? 'secondary' : 'ghost'"
              size="sm"
              :disabled="action === 'retry' && retryWait > 0"
              :class="TOUCH_TARGET_CLASS"
              :data-test="`inline-helper-${action}`"
              @click="onAction(action)"
            >
              {{ t(ACTION_KEYS[action as LabelledAction]) }}
            </OButton>
          </template>
        </span>
      </div>
      <div
        v-if="rangeDiffers"
        class="flex min-w-0 flex-wrap items-center gap-2"
        data-test="inline-helper-range"
      >
        <OText variant="meta" as="p" class="min-w-0 break-words">{{ rangeDiffers }}</OText>
        <OButton
          v-if="host.setTimeRange"
          variant="secondary"
          size="sm"
          :class="TOUCH_TARGET_CLASS"
          data-test="inline-helper-range-use"
          @click="useProposedRange"
        >
          {{ t("assistant.helper.useProposedRange") }}
        </OButton>
        <OButton
          variant="ghost"
          size="sm"
          :class="TOUCH_TARGET_CLASS"
          data-test="inline-helper-range-keep"
          @click="proposedRange = null"
        >
          {{ t("assistant.helper.keepMyRange") }}
        </OButton>
      </div>
    </div>

    <AssistantConsentCard
      v-if="consentCard"
      ref="consentEl"
      :key="`consent:${consentCard.sid}`"
      v-bind="consentCard"
      @enable="resolveConsent(true)"
      @cancel="resolveConsent(false)"
    />
  </section>
</template>

<script lang="ts">
import type {
  AssistantErrorCode,
  EntryKind,
  InlineHostAdapter,
  ProposalHostId,
} from "@/composables/assistant/pure";
import { isDockHostId } from "@/composables/assistant/pure";
import type { I18nKey } from "@/types/i18n";

export interface InlineQueryHelperProps {
  host: InlineHostAdapter;
  open: boolean;
  prefill?: { text: string; mode: "edit" | "replace" };
  /** How the row was opened, for the session's origin. */
  entryKind?: EntryKind;
}

export interface InlineQueryHelperEmits {
  (e: "update:open", open: boolean): void;
  (e: "handoff"): void;
  (e: "accepted", text: string): void;
  (e: "reverted"): void;
}

/** Validation shows "Checking…" only past this; a fast check never flashes it. */
export const CHECKING_DELAY_MS = 300;

type Mode = "edit" | "replace" | "replaceText";

type LineAction =
  | "retry"
  | "write-myself"
  | "open-chat"
  | "answer-chat"
  | "edit-prompt"
  | "fix"
  | "manage-usage"
  | "ask-admin"
  | "check-status"
  | "details";

const CHIP_CLASS = "max-md:h-auto max-md:min-h-11 max-md:whitespace-normal";

/** The named route of Settings › Assistant; "Check assistant status" appears once the app has it. */
export const ASSISTANT_STATUS_ROUTE = "assistantSettings";

type LabelledAction = Exclude<LineAction, "ask-admin" | "details">;

const ACTION_KEYS: Record<LabelledAction, I18nKey> = {
  retry: "assistant.outcome.retry",
  "write-myself": "assistant.helper.writeMyself",
  "open-chat": "assistant.helper.openInChat",
  "answer-chat": "assistant.helper.answerInChat",
  "edit-prompt": "assistant.helper.editPrompt",
  fix: "assistant.helper.askToFix",
  "manage-usage": "assistant.outcome.actions.managePaidUsage",
  "check-status": "assistant.helper.checkStatus",
};

// Each failure code's line and actions; codes not listed read as the unknown failure.
const FAILURE_LINES: Partial<Record<AssistantErrorCode, { key: I18nKey; actions: LineAction[] }>> =
  {
    offline: { key: "assistant.helper.offline", actions: ["retry", "write-myself"] },
    session_expired: { key: "assistant.helper.signedOut", actions: [] },
    signed_out: { key: "assistant.helper.signedOut", actions: [] },
    turn_busy: { key: "assistant.helper.busy", actions: ["retry"] },
    already_submitted: { key: "assistant.helper.busy", actions: ["retry"] },
    unreachable: { key: "assistant.helper.unreachable", actions: ["retry", "write-myself"] },
    agent_unavailable: { key: "assistant.helper.unreachable", actions: ["retry", "write-myself"] },
    authorization_unavailable: {
      key: "assistant.helper.unreachable",
      actions: ["retry", "write-myself"],
    },
    permission_denied: { key: "assistant.gate.noPermission.tooltip", actions: [] },
  };

// Failures that count as a failed proposal; refusals are not proposals.
const FAILED_PROPOSAL_CODES: ReadonlySet<string> = new Set([
  "offline",
  "rate_limited",
  "turn_limit",
  "unreachable",
  "agent_unavailable",
  "unknown",
  "provider_error",
  "stream_dropped",
]);

/** The analytics `host` of an editor that has no id of its own. */
export function helperHostKey(host: { id?: ProposalHostId }): ProposalHostId {
  return host.id ?? "logs";
}

/** The streams the chips name and the request carries; empty when none is selected. */
export function streamsOf(host: Pick<InlineHostAdapter, "stream" | "streams">): string[] {
  if (host.streams?.length) return host.streams.filter(Boolean);
  return host.stream ? [host.stream] : [];
}
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { useRouter } from "vue-router";
import { useStore } from "vuex";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import AssistantErrorDetails from "@/components/ai-assistant/common/AssistantErrorDetails.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import AssistantConsentCard from "@/components/ai-assistant/credits/AssistantConsentCard.vue";
import AssistantAskAdminPopover from "@/components/ai-assistant/gate/AssistantAskAdminPopover.vue";
import AssistantTurnStatus from "@/components/ai-assistant/turn/AssistantTurnStatus.vue";
import {
  consentCardFor,
  isMeteredCredit,
  openAssistant,
  orgDisplayName,
  proposalFor,
  registerEscapeRung,
  stopLadderEscape,
  timeChipOf,
  timeRangeText,
  useAssistantCapability,
  useAssistantCredits,
  useAssistantStore,
  useTurnLock,
  turnLockKey,
} from "@/composables/assistant";
import type {
  ContextChip,
  EditorProposal,
  ProposalChecks,
  ProposalChoice,
} from "@/composables/assistant/pure";
import {
  PROPOSAL_LANGUAGE_NAMES,
  validateProposal,
  type ProposalValidation,
} from "@/composables/assistant/pure";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { doorChip, queryChip } from "@/utils/assistant/prompts/format";
import { formatOrgDay } from "@/utils/formatters";

import { readsAsPlainLanguage } from "./helperText";
import { useInlineHelperSession, type HelperState } from "./useInlineHelperSession";

type RowView =
  | HelperState
  | { kind: "checking" }
  | { kind: "checked"; validation: ProposalValidation }
  | { kind: "inserted" }
  | { kind: "identical" }
  | { kind: "discarded" }
  | { kind: "rejected" };

const props = withDefaults(defineProps<InlineQueryHelperProps>(), {
  prefill: undefined,
  entryKind: "editor_button",
});
const emit = defineEmits<InlineQueryHelperEmits>();

const { t } = useI18nTyped();
const vuex = useStore();
const router = useRouter();
const capability = useAssistantCapability();
const store = useAssistantStore();
const root = ref<HTMLElement | null>(null);
const prompt = ref<InstanceType<typeof OTextarea> | null>(null);
const consentEl = ref<InstanceType<typeof AssistantConsentCard> | null>(null);
const text = ref(props.prefill?.text ?? "");
const replaceToggled = ref(props.prefill?.mode === "replace");
const local = shallowRef<RowView | null>(null);
const proposedRange = ref<{ from: number; to: number } | null>(null);
const accepted = ref(false);
const endedAt = ref(Date.now());
const retryWait = ref(0);
const lastPrompt = ref("");
const announcement = ref<I18nText>(raw(""));
let checkTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setInterval> | null = null;
let offRung: (() => void) | null = null;
let validated: ProposalValidation["status"] = "skipped";
let recalled: string | null = null;
let unmounted = false;

const hostKey = computed(() => helperHostKey(props.host));
const inline = computed(() => props.host);
const session = useInlineHelperSession(inline.value, { entryKind: () => props.entryKind });
const lock = useTurnLock(() => session.sid.value);

const org = computed<string>(() => vuex.state.selectedOrganization?.identifier ?? "");
const isAdmin = computed(() => capability.value.isAdmin);
const canCheckStatus = computed(() => isAdmin.value && router.hasRoute(ASSISTANT_STATUS_ROUTE));
const usable = computed(
  () => capability.gate.value === "available" || capability.gate.value === "unhealthy",
);
const language = computed(() => props.host.language);
const languageName = computed(() => raw(PROPOSAL_LANGUAGE_NAMES[language.value]));
const controller = computed<EditorProposal | null>(() => proposalFor(hostKey.value));

const view = computed<RowView>(() => {
  const state = session.state.value;
  if (state.kind === "running" || state.kind === "consent") return state;
  return local.value ?? state;
});
const running = computed(() => view.value.kind === "running" || view.value.kind === "consent");
const stopping = computed(
  () => view.value.kind === "running" && view.value.turn.state === "stopping",
);

// The host's getter reads the editor's reactive query, so this follows every edit and Accept.
const buffer = computed(() => props.host.getBuffer());
const mode = computed<Mode>(() => modeOf(buffer.value));
const modeText = computed(() => {
  if (mode.value === "edit") return t("assistant.helper.mode.edit");
  return mode.value === "replace"
    ? t("assistant.helper.mode.replace")
    : t("assistant.helper.mode.replaceText");
});

const pickerWindow = computed(() => {
  const range = inline.value.timeRange;
  return range ? { ...range, source: "page" as const } : null;
});
const pickerText = computed(() =>
  pickerWindow.value ? timeRangeText(pickerWindow.value, t) : t("assistant.helper.chip.noTime"),
);
const streams = computed(() => streamsOf(inline.value));
const contextChips = computed<{ kind: "time" | "stream"; text: I18nText }[]>(() => {
  const chips: { kind: "time" | "stream"; text: I18nText }[] = [
    { kind: "time", text: t("assistant.helper.chip.time", { range: pickerText.value }) },
  ];
  if (inline.value.stream === undefined) return chips;
  chips.push({
    kind: "stream",
    text: streams.value.length
      ? t("assistant.context.chip.stream", { name: raw(streams.value.join(", ")) })
      : t("assistant.helper.chip.noStream"),
  });
  return chips;
});
const alsoSends = computed(() => {
  const items = inline.value.alsoSends?.() ?? [];
  return items.length ? t("assistant.helper.alsoSends", { items: raw(items.join(", ")) }) : null;
});

const sendBlocked = computed<I18nText | null>(() => {
  if (inline.value.stream === "") return t("assistant.helper.noStream");
  if (lock.value) return t(turnLockKey(lock.value));
  return null;
});
const canSend = computed(() => !!text.value.trim() && !sendBlocked.value);
const metered = computed(() => isMeteredCredit(capability.value.creditMode));
const credits = useAssistantCredits(
  () => org.value,
  () => metered.value,
  () => isAdmin.value,
);
const sendTooltip = computed(() => {
  if (sendBlocked.value) return sendBlocked.value;
  return metered.value ? t("assistant.helper.cost") : t("assistant.helper.doorTooltip");
});

const examples = computed<I18nText[]>(() => {
  const lang = language.value;
  const set = accepted.value
    ? "refine"
    : lang === "promql" || lang === "vrl" || lang === "js"
      ? lang
      : "sql";
  return ([1, 2, 3] as const).map((n) => t(`assistant.helper.example.${set}${n}`));
});

const rangeDiffers = computed<I18nText | null>(() => {
  const proposed = proposedRange.value;
  const picker = inline.value.timeRange;
  if (!proposed || !picker) return null;
  if (Math.abs(proposed.from - picker.from) < 60_000 && Math.abs(proposed.to - picker.to) < 60_000)
    return null;
  return t("assistant.helper.rangeDiffers", {
    proposed: timeRangeText({ ...proposed, source: "custom" }, t),
    picker: pickerText.value,
  });
});

const consentCard = computed(() =>
  view.value.kind === "consent"
    ? consentCardFor(store.state.sessions[session.sid.value ?? ""] ?? null, orgNameOf, "compact")
    : null,
);

interface Line {
  text: I18nText;
  actions: LineAction[];
  failure?: boolean;
}

const line = computed<Line | null>(() => lineOf(view.value));

watch(
  () => session.state.value,
  (state, was) => {
    if (state.kind === "running" && was?.kind !== "running") onTurnStarted();
    if (state.kind === "proposal" || state.kind === "needs_chat" || state.kind === "needs_detail")
      void onAnswered(state);
    if (state.kind === "wanted_change") track("handoff_offered", "skipped");
    if (state.kind === "failed") onFailed(state);
    if (state.kind === "stopped" || state.kind === "not_sent" || state.kind === "failed")
      endedAt.value = Date.now();
  },
);

watch(
  () => props.prefill,
  (prefill) => {
    if (!prefill) return;
    text.value = prefill.text;
    replaceToggled.value = prefill.mode === "replace";
  },
);

// A 403 or a gate that closes collapses the row to the locked door.
watch(usable, (ok) => {
  if (!ok && props.open) emit("update:open", false);
});

// The row mounts and unmounts with `open`, so the Escape stop follows the element.
watch(
  root,
  (el, prev) => {
    prev?.removeEventListener("keydown", stopLadderEscape);
    el?.addEventListener("keydown", stopLadderEscape);
  },
  { flush: "post" },
);

watch(
  () => props.open,
  (open) => {
    if (open) void focusPrompt();
  },
);

// Announced once per state; the 429 countdown and elapsed seconds change only the visible line.
watch(
  () => (line.value ? announceKeyOf(view.value) : null),
  (key) => {
    if (key && line.value) announcement.value = line.value.text;
  },
);

watch(
  () => view.value.kind,
  (kind) => {
    if (kind === "consent") void nextTick(() => consentEl.value?.focusHeading?.());
  },
);

onMounted(() => {
  offRung = registerEscapeRung("d", onEscape);
  if (props.open) void focusPrompt();
});

onBeforeUnmount(() => {
  unmounted = true;
  root.value?.removeEventListener("keydown", stopLadderEscape);
  offRung?.();
  clearTimers();
});

defineExpose({ focusPrompt });

async function focusPrompt(): Promise<void> {
  await nextTick();
  prompt.value?.focus();
}

function toggleMode(): void {
  if (mode.value === "replaceText") return;
  replaceToggled.value = !replaceToggled.value;
}

function fill(example: I18nText): void {
  text.value = example;
  void focusPrompt();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (canSend.value && !running.value) void send();
    return;
  }
  // Recall runs on an empty prompt and keeps running while the prompt still holds the recalled entry.
  const recalling = !text.value.trim() || (recalled !== null && text.value === recalled);
  if ((event.key === "ArrowUp" || event.key === "ArrowDown") && recalling) {
    const next = session.recall(event.key === "ArrowUp" ? "older" : "newer");
    if (next === null) {
      if (event.key === "ArrowDown" && recalled !== null) text.value = "";
      recalled = null;
      return;
    }
    event.preventDefault();
    recalled = next;
    text.value = next;
  }
}

async function send(extra?: string): Promise<void> {
  if (running.value || !canSend.value) return;
  local.value = null;
  proposedRange.value = null;
  recalled = null;
  controller.value?.discard();
  const ask = extra ? `${text.value.trim()}\n\n${extra}` : text.value.trim();
  lastPrompt.value = text.value.trim();
  // Read at send time: the user may have edited the editor since the row opened.
  const current = props.host.getBuffer();
  await session.send(ask, {
    current: modeOf(current) === "edit" ? current : null,
    chips: requestChips(),
    window: pickerWindow.value,
  });
}

// A refusal before admission keeps its turn id; any other failure sends the prompt again.
async function retry(): Promise<void> {
  local.value = null;
  if (view.value.kind === "failed" && view.value.error.phase === "pre_admission") {
    await session.retry();
    return;
  }
  await send();
}

async function stop(): Promise<void> {
  await session.stop();
}

function close(): void {
  controller.value?.discard();
  emit("update:open", false);
  void nextTick(() => props.host.focusEditor());
}

function onEscape(event: KeyboardEvent): boolean {
  const target = event.target instanceof Node ? event.target : null;
  if (!target || !root.value?.contains(target)) return false;
  const pending = controller.value?.pending.value;
  if (pending) {
    pending.reject();
    return true;
  }
  close();
  return true;
}

function onTurnStarted(): void {
  local.value = null;
  announcement.value = t("assistant.turn.sending");
}

async function onAnswered(state: HelperState): Promise<void> {
  if (state.kind === "needs_chat") return track("no_query", "skipped");
  if (state.kind === "needs_detail") return track("handoff_offered", "skipped");
  if (state.kind !== "proposal") return;
  const editor = controller.value;
  if (!editor) return;
  proposedRange.value = state.timeRange ?? null;
  const check = validateProposal(
    language.value,
    state.text,
    inline.value.schemaFields?.(),
    typeof state.validated === "boolean" ? { validated: state.validated } : undefined,
  );
  const handle = await editor.propose(state.text, {
    mode: "replace",
    provenance: {
      prompt: lastPrompt.value,
      ...(inline.value.stream && { stream: inline.value.stream }),
      ...(inline.value.timeRange && {
        range: { from: inline.value.timeRange.from, to: inline.value.timeRange.to },
      }),
    },
    canRun: !!props.host.run,
    checks: { state: "checking" },
    onDecided: (choice) => onDecided(choice),
  });
  const id = editor.pending.value?.id;
  if (unmounted) return;
  if (id === undefined) {
    local.value = { kind: "identical" };
    return;
  }
  checkTimer = setTimeout(() => {
    if (editor.pending.value?.id === id) local.value = { kind: "checking" };
  }, CHECKING_DELAY_MS);
  const validation = await check;
  if (checkTimer) clearTimeout(checkTimer);
  checkTimer = null;
  validated = validation.status;
  if (unmounted || editor.pending.value?.id !== id) return;
  editor.annotate(id, checksOf(validation));
  local.value = { kind: "checked", validation };
  track("proposal", validation.status);
  void handle.decision;
}

function checksOf(validation: ProposalValidation): ProposalChecks {
  const over = pickerWindow.value
    ? t("assistant.helper.scanRangeOnly", { range: pickerText.value })
    : undefined;
  return {
    state: validation.status,
    ...(validation.unknownFields?.length && {
      unknownCount: validation.unknownFields.length,
      unknownFields: validation.unknownFields,
    }),
    ...(validation.status === "error" && { runBlocked: t("assistant.diff.fixFirst") }),
    ...(over && { runNote: over }),
  };
}

function onDecided(choice: ProposalChoice): void {
  const decision = choice === "discarded" ? "edited_before_accept" : choice;
  trackAssistant("ai_nl_decided", { decision, validated });
  if (choice === "accept" || choice === "accept_run") {
    accepted.value = true;
    replaceToggled.value = false;
    local.value = { kind: "inserted" };
    emit("accepted", props.host.getBuffer());
  } else if (choice === "reject") local.value = { kind: "rejected" };
  else local.value = { kind: "discarded" };
}

function onFailed(state: Extract<HelperState, { kind: "failed" }>): void {
  if (state.error.code === "permission_denied") return;
  if (FAILED_PROPOSAL_CODES.has(state.error.code)) track("failed", "skipped");
  const wait = state.error.retryAfterMs;
  if (state.error.code === "rate_limited" && wait) startRetryCountdown(Math.ceil(wait / 1000));
}

function startRetryCountdown(seconds: number): void {
  retryWait.value = seconds;
  if (retryTimer) clearInterval(retryTimer);
  retryTimer = setInterval(() => {
    retryWait.value -= 1;
    if (retryWait.value > 0) return;
    if (retryTimer) clearInterval(retryTimer);
    retryTimer = null;
  }, 1_000);
}

function track(
  outcome: "proposal" | "no_query" | "handoff_offered" | "failed",
  status: ProposalValidation["status"],
): void {
  trackAssistant("ai_nl_proposal", {
    outcome,
    language: language.value,
    host: hostKey.value,
    validated: status,
  });
}

function lineOf(state: RowView): Line | null {
  const stream = raw(inline.value.stream || "");
  switch (state.kind) {
    case "checking":
      return { text: t("assistant.helper.checking"), actions: [] };
    case "checked":
      return checkedLine(state.validation, stream);
    case "inserted":
      return { text: t("assistant.helper.inserted"), actions: [] };
    case "identical":
      return { text: t("assistant.helper.alreadyDoes"), actions: [] };
    case "discarded":
      return { text: t("assistant.helper.discarded"), actions: [] };
    case "stopped":
      return { text: t("assistant.helper.stopped"), actions: [] };
    case "not_sent":
      return { text: t("assistant.helper.notSent"), actions: [] };
    case "needs_chat":
      return {
        text: raw([t("assistant.helper.needsChat"), state.line].filter((part) => !!part).join(" ")),
        actions: ["open-chat", "edit-prompt"],
      };
    case "needs_detail":
      return {
        text: t("assistant.helper.needsDetail", { question: raw(state.question) }),
        actions: ["answer-chat", "edit-prompt"],
      };
    case "wanted_change":
      return { text: t("assistant.helper.wantedChange"), actions: ["open-chat"] };
    case "failed":
      return failureLine(state);
    default:
      return null;
  }
}

function checkedLine(validation: ProposalValidation, stream: I18nText): Line {
  const named = !!inline.value.stream;
  if (validation.unknownFields?.length) {
    const fields = validation.unknownFields;
    const text =
      fields.length === 1
        ? t("assistant.helper.unknownField", { field: raw(fields[0]), stream })
        : t("assistant.helper.unknownFields", {
            count: fields.length,
            stream,
            fields: raw(fields.join(", ")),
          });
    return { text, actions: ["fix"], failure: true };
  }
  if (validation.status === "error")
    return {
      text: t("assistant.helper.parseError", {
        language: languageName.value,
        message: validation.message ?? raw(""),
      }),
      actions: ["fix"],
      failure: true,
    };
  if (validation.status === "skipped")
    return {
      text: named
        ? t("assistant.helper.notChecked", { language: languageName.value, stream })
        : t("assistant.helper.notCheckedNoStream", { language: languageName.value }),
      actions: [],
    };
  const wrote = named
    ? t("assistant.helper.wrote", { language: languageName.value, stream, range: pickerText.value })
    : t("assistant.helper.wroteNoStream", { language: languageName.value });
  return {
    text: metered.value ? raw(`${wrote} ${t("assistant.helper.cost")}`) : wrote,
    actions: [],
  };
}

function failureLine(state: Extract<HelperState, { kind: "failed" }>): Line {
  const code = state.error.code;
  const failed = (text: I18nText, actions: LineAction[]): Line => ({
    text,
    actions,
    failure: true,
  });
  if (code === "credits_exhausted" || code === "subscription_required") {
    const resetsAt = code === "credits_exhausted" ? credits.usage.value?.resetsAt : undefined;
    return failed(
      resetsAt === undefined
        ? t("assistant.helper.creditsExhaustedNoDate")
        : t("assistant.helper.creditsExhaustedResets", { date: raw(formatOrgDay(resetsAt)) }),
      [isAdmin.value ? "manage-usage" : "ask-admin"],
    );
  }
  if (code === "rate_limited" || code === "turn_limit")
    return failed(
      retryWait.value > 0
        ? t("assistant.helper.rateLimited", { seconds: retryWait.value })
        : t("assistant.helper.rateLimitedNow"),
      ["retry"],
    );
  if (code === "stream_dropped")
    return failed(
      t("assistant.helper.dropped", { seconds: Math.max(1, Math.round(state.elapsedMs / 1000)) }),
      ["retry", "write-myself"],
    );
  const known = FAILURE_LINES[code];
  if (!known) return failed(t("assistant.helper.unknown"), ["retry", "details"]);
  const statusShown = known.key === "assistant.helper.unreachable" && canCheckStatus.value;
  return failed(t(known.key), statusShown ? [...known.actions, "check-status"] : known.actions);
}

function onAction(action: LineAction): void {
  switch (action) {
    case "retry":
      if (!sendBlocked.value) void retry();
      return;
    case "write-myself":
      return close();
    case "open-chat":
    case "answer-chat":
      void handoff();
      return;
    case "edit-prompt":
      void focusPrompt();
      return;
    case "fix":
      return void sendFix();
    case "manage-usage":
      void router
        .push({ name: "plans", query: { org_identifier: org.value } })
        .catch(() => undefined);
      return;
    case "check-status":
      void router
        .push({ name: ASSISTANT_STATUS_ROUTE, query: { org_identifier: org.value } })
        .catch(() => undefined);
      return;
    default:
      return;
  }
}

async function sendFix(): Promise<void> {
  const state = view.value;
  if (state.kind !== "checked") return;
  const problem = state.validation.unknownFields?.length
    ? `Unknown fields: ${state.validation.unknownFields.join(", ")}`
    : `Parse error: ${state.validation.message ?? ""}`;
  await send(problem);
}

function useProposedRange(): void {
  const range = proposedRange.value;
  if (range) inline.value.setTimeRange?.(range);
  proposedRange.value = null;
}

function orgNameOf(id: string): string {
  return orgDisplayName(id, vuex.state.selectedOrganization);
}

function resolveConsent(acceptedConsent: boolean): void {
  const sid = session.sid.value;
  if (!sid) return;
  void store.resolveConsent(sid, acceptedConsent, acceptedConsent);
  if (!acceptedConsent) void focusPrompt();
}

async function handoff(): Promise<void> {
  const answer = answerOf(view.value);
  const chips = handoffChips();
  const result = await openAssistant({
    entryKind: "nl_toggle",
    entryVerb: "ask",
    objectKind: "none",
    intent: "stage",
    thread: "new",
    container: "auto",
    ...(isDockHostId(hostKey.value) && { dockHost: hostKey.value }),
    invoker: root.value,
    payload: {
      text: text.value.trim(),
      chips,
      ...(answer && { transcript: [{ role: "assistant" as const, text: answer }] }),
    },
  });
  if (!result.ok) return;
  controller.value?.discard();
  emit("handoff");
  emit("update:open", false);
}

function answerOf(state: RowView): string | null {
  if (
    state.kind === "needs_chat" ||
    state.kind === "needs_detail" ||
    state.kind === "wanted_change"
  )
    return state.answer || null;
  return null;
}

function streamChipOf(stream: string): ContextChip {
  return doorChip({
    kind: "stream",
    key: `${org.value}|stream|${stream}`,
    label: t("assistant.context.chip.stream", { name: raw(stream) }),
    ref: { type: "stream", org: org.value, stream },
    sent: "whitelist",
  });
}

// The request carries the same Time and Stream the chips show, never the page's own.
function requestChips(): ContextChip[] {
  return streams.value.map(streamChipOf);
}

function handoffChips(): ContextChip[] {
  const chips: ContextChip[] = [];
  if (pickerWindow.value) chips.push(timeChipOf(pickerWindow.value, org.value, t));
  chips.push(...streams.value.map(streamChipOf));
  const current = props.host.getBuffer().trim();
  const stream = streams.value.length === 1 ? streams.value[0] : undefined;
  if (current && (accepted.value || modeOf(current) === "edit"))
    chips.push(
      queryChip(
        {
          org: org.value,
          query: current,
          language: language.value,
          ...(stream && { stream }),
          ...(pickerWindow.value && {
            range: { from: pickerWindow.value.from, to: pickerWindow.value.to },
          }),
        },
        t,
      ),
    );
  return chips;
}

function modeOf(current: string): Mode {
  if (!current.trim() || readsAsPlainLanguage(current)) return "replaceText";
  return replaceToggled.value ? "replace" : "edit";
}

function announceKeyOf(state: RowView): string {
  return state.kind === "failed" ? `failed:${state.error.code}:${session.sid.value}` : state.kind;
}

function clearTimers(): void {
  if (checkTimer) clearTimeout(checkTimer);
  if (retryTimer) clearInterval(retryTimer);
  checkTimer = null;
  retryTimer = null;
}
</script>
