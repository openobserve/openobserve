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
    data-test="assistant-composer-root"
    data-dd-privacy="mask"
    class="flex shrink-0 flex-col px-3 pt-1.5 pb-2"
  >
    <div class="relative">
      <AssistantMentionMenu
        ref="mention"
        :open="mentionAt !== null"
        :query="mentionQuery"
        :org="org"
        :listbox-id="listboxId"
        :sid="liveSid"
        @select="pickMention"
        @close="closeMention"
      />
      <AssistantComposerFrame
        ref="textbox"
        :model-value="shownText"
        :state="state"
        :inert="inertKind !== null"
        :trailing="voice.mine.value"
        :opening="opening"
        :readonly="inertKind !== null"
        :placeholder="placeholder"
        :input-attrs="textboxAttrs"
        :tabindex="inertKind ? -1 : undefined"
        placeholder-tone="strong"
        data-test="assistant-composer"
        :data-state="state"
        @update:model-value="onInput"
        @keydown="onKeydown"
        @paste="onPaste"
        @focus="refreshPageContext"
        @blur="onBlur"
      >
        <template #strip>
          <AssistantComposerStrip :notice="notice" :sentence-id="noticeId" @action="onNoticeAction">
            <slot v-if="!replying" name="chips" />
            <template #link-askAdmin>
              <AssistantAskAdminPopover kind="access" :org="org">
                <template #trigger>
                  <OButton
                    variant="ghost-primary"
                    size="chip"
                    class="h-auto! min-h-0! px-0! font-medium"
                    data-test="assistant-composer-ask-admin"
                  >
                    {{ t("assistant.gate.noPermission.askAdmin") }}
                  </OButton>
                </template>
              </AssistantAskAdminPopover>
            </template>
            <template v-if="seesShown" #sees>
              <AssistantContextSeesPopover :sid="liveSid" placement="top">
                <template v-if="storageBlocked" #detail>
                  <OText variant="meta" as="p" data-test="assistant-composer-storage-blocked">
                    {{ t("assistant.client.storageBlocked") }}
                  </OText>
                </template>
              </AssistantContextSeesPopover>
            </template>
          </AssistantComposerStrip>
        </template>
        <template #trailing>
          <AssistantDictationWave :elapsed-ms="voice.elapsedMs.value" />
        </template>
        <template #bar>
          <AssistantComposerBottomRow>
            <template #agent>
              <AssistantAgentPicker :sid="sid" :disabled="inertKind !== null || accessLost" />
            </template>
            <AssistantIconButton
              v-if="!replying"
              :label="t('assistant.composer.attachImage')"
              :icon="assistantGlyph.chipImage"
              :disabled="inertKind !== null"
              data-test="assistant-attach-image"
              @click="openPicker"
            />
            <AssistantIconButton
              v-if="coarse && recallEntries.length > 0"
              :label="t('assistant.composer.recentPrompts')"
              :icon="assistantGlyph.history"
              :disabled="inertKind !== null"
              aria-haspopup="dialog"
              :aria-expanded="recallOpen"
              data-test="assistant-recall-open"
              @click="recallOpen = true"
            />
            <AssistantDictateButton
              v-if="voice.mic.value !== 'none'"
              :mic="accessLost || inertKind ? 'crossed' : voice.mic.value"
              :pressed="voice.mine.value"
              :disabled-reason="voice.helperLine.value ?? micOffReason"
              @press="onMicPress"
            />
            <AssistantIconButton
              v-if="showStop"
              variant="primary"
              size="md"
              :label="t('assistant.turn.stopLabel')"
              :icon="assistantGlyph.stop"
              :loading="state === 'stopping'"
              :class="ROUND_ACTION_CLASS"
              data-test="assistant-stop"
              @click="stop"
            />
            <AssistantIconButton
              v-else
              variant="primary"
              size="md"
              :label="sendLabel"
              :icon="assistantGlyph.send"
              :disabled="!canSend"
              :disabled-reason="sendBlockedReason"
              :class="ROUND_ACTION_CLASS"
              data-test="assistant-send"
              @click="trySend"
            />
          </AssistantComposerBottomRow>
        </template>
      </AssistantComposerFrame>
      <AssistantDictationTail
        :field="textbox?.textarea ?? null"
        :before="text.slice(0, voice.anchor.value)"
        :tail="voice.tail.value"
      />
    </div>

    <span role="status" aria-live="polite" class="sr-only" data-test="assistant-composer-status">
      <span v-if="status" :key="status.seq">{{ status.text }}</span>
    </span>

    <OFile
      ref="file"
      class="hidden"
      accept="image/png,image/jpeg"
      :type-error-toast="false"
      multiple
      :model-value="null"
      :max-file-size="MAX_IMAGE_SIZE_BYTES"
      @change="onPicked"
      @size-error="(files) => files.forEach(refuseSize)"
      @type-error="() => refuse('type', t('assistant.context.imageType'))"
    />
    <AssistantRecallSheet
      v-if="coarse"
      v-model:open="recallOpen"
      :entries="recallEntries"
      @select="pickRecall"
    />
  </div>
</template>

<script lang="ts">
import type { AssistantHostAdapter, ContextChip, Sid, TurnTerminal } from "@/composables/assistant";
import type { I18nText } from "@/types/i18n";

export interface AssistantComposerProps {
  sid: Sid | null;
  density?: "compact" | "roomy";
  host?: AssistantHostAdapter;
  /** Only the composer the user sees announces, restores and takes focus requests. */
  visible?: boolean;
  /** Send waits while the host counts a `retry_after` down; the reason says why. */
  cooldownReason?: I18nText;
  /** Access went mid-session: the draft stays readable and nothing can be sent. */
  accessLost?: boolean;
  /** The container just opened; the frame plays its one border sweep. */
  opening?: boolean;
}

export interface AssistantComposerEmits {
  /** The run-limit notice's link; the shell owns the running-chats list. */
  (e: "show-running"): void;
}

/** A starter prompt over a draft this long asks Replace · Append · Cancel (IW-06 AC 5). */
export const PREFILL_CHOICE_CHARS = 500;

// Long enough that typing a query speaks once, not per key.
const MENTION_ANNOUNCE_MS = 400;

const CARET_KEYS: ReadonlySet<string> = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

const THREAD_WINDOW_MS = 30 * 60_000;

// Either control returns with the card's next render, so focus waits for it.
const REPLY_SELECTOR =
  '[data-test="assistant-approval-reply"], [data-test="assistant-question-other"]';

const CARD_SELECTOR = '[data-test="assistant-approval-card"], [data-test="assistant-consent-card"]';
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, useId, watch } from "vue";
import { useRouter } from "vue-router";

import AssistantAgentPicker from "@/components/ai-assistant/agents/AssistantAgentPicker.vue";
import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { billingHrefOf } from "@/components/ai-assistant/credits/AssistantCreditManage.vue";
import AssistantContextSeesPopover from "@/components/ai-assistant/context/AssistantContextSeesPopover.vue";
import AssistantMentionMenu, {
  type MentionOption,
} from "@/components/ai-assistant/context/AssistantMentionMenu.vue";
import AssistantAskAdminPopover from "@/components/ai-assistant/gate/AssistantAskAdminPopover.vue";
import { isCreditsRefusal } from "@/components/ai-assistant/turn/creditsRefusal";
import {
  MAX_IMAGES,
  STALL_MS,
  UNDO_WINDOW_MS,
  assistantFocusCard,
  assistantGoToAnswer,
  isLongPaste,
  isRunning,
  markHintSeen,
  pastedTextChip,
  readHints,
  readRecall,
  refreshPageContext,
  registerAssistantFocusTarget,
  registerEscapeRung,
  turnLockKey,
  useAssistantContext,
  useAssistantPlacement,
  useAssistantStore,
  type RecallEntry,
} from "@/composables/assistant";
import {
  DEFAULT_AGENT,
  agentIdOf,
  agentName,
  currentAgent,
  errorTitle,
  nextAgent,
  openTabWithoutOpener,
} from "@/composables/assistant/pure";
import useBreakpoint from "@/composables/useBreakpoint";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OFile from "@/lib/forms/File/OFile.vue";
import type { FileValue } from "@/lib/forms/File/OFile.types";
import { trackAssistant } from "@/services/assistantAnalytics";
import { MAX_IMAGE_SIZE_BYTES } from "@/ts/interfaces/chat";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatBytes } from "@/utils/formatters";
import { getUUIDv7 } from "@/utils/uuid";

import AssistantComposerBottomRow, { ROUND_ACTION_CLASS } from "./AssistantComposerBottomRow.vue";
import AssistantComposerFrame from "./AssistantComposerFrame.vue";
import AssistantComposerStrip from "./AssistantComposerStrip.vue";
import AssistantDictateButton from "./AssistantDictateButton.vue";
import AssistantDictationTail from "./AssistantDictationTail.vue";
import AssistantDictationWave from "./AssistantDictationWave.vue";
import AssistantRecallSheet from "./AssistantRecallSheet.vue";
import {
  lineCount,
  micHelpUrl,
  pickNotice,
  sentenceNotice,
  type ComposerNotice,
  type NoticeAction,
} from "./composerNotice";
import {
  BUSY_CODES,
  CAP_NOTICE_MS,
  announceComposer,
  composerLayoutKey,
  composerRowOf,
  composerUi,
  moveDraft,
  forgetComposerUi,
  noteCap,
  noteDraftCleared,
} from "./composerUi";
import { useAssistantVoice } from "./useAssistantVoice";
import { useComposerQueue } from "./useComposerQueue";
import { useComposerWidth } from "./useComposerWidth";

const props = withDefaults(defineProps<AssistantComposerProps>(), {
  density: "compact",
  host: undefined,
  visible: true,
  cooldownReason: undefined,
  accessLost: false,
  opening: false,
});

const emit = defineEmits<AssistantComposerEmits>();

const { t } = useI18nTyped();
const store = useAssistantStore();
const placement = useAssistantPlacement(store);
const router = useRouter();
const { mdUp } = useBreakpoint();
const root = ref<HTMLElement | null>(null);
const textbox = ref<InstanceType<typeof AssistantComposerFrame> | null>(null);
const file = ref<InstanceType<typeof OFile> | null>(null);
const mention = ref<InstanceType<typeof AssistantMentionMenu> | null>(null);
const width = useComposerWidth(root);
const uid = useId();
const listboxId = `assistant-mention-${uid}`;
const noticeId = `assistant-composer-notice-${uid}`;

// View state only; every draft write is a store action.
const blockedLine = ref<I18nText | null>(null);
const droppedImages = ref(0);
const recallOpen = ref(false);
const recallEntries = ref<RecallEntry[]>([]);
const mentionAt = ref<number | null>(null);
const mentionQuery = ref("");
const prefillPending = ref<{ text: string; chips: ContextChip[]; homeStarter?: boolean } | null>(
  null,
);
// The last long paste, offered back as plain text until the next edit or send (D4 decision 10).
const pasteOffer = ref<{ chipId: string; text: string; at: number } | null>(null);
const attachDismissed = ref(false);
// An admin pressed a mic that is off in this browser; the strip offers Turn on until the next edit.
const offOffer = ref(false);
const now = ref(Date.now());
let emptyEnterSaid = false;
let recallPicked = false;
let mentionTimer: ReturnType<typeof setTimeout> | null = null;
let pointerDown = false;
let cancelDeferredClose: (() => void) | null = null;
let clearedTimer: ReturnType<typeof setTimeout> | null = null;
let capTimer: ReturnType<typeof setTimeout> | null = null;
const usedSendIds = new Set<string>();
const offs: (() => void)[] = [];

function el(): HTMLTextAreaElement | null {
  return textbox.value?.textarea ?? null;
}

const ownSession = computed(() => store.state.sessions[props.sid ?? ""] ?? null);
// A chat of another user+org is never written to, so an org switch leaves this composer empty (D21).
const session = computed(() =>
  ownSession.value && ownSession.value.userOrgKey === store.state.userOrgKey
    ? ownSession.value
    : null,
);
const liveSid = computed(() => session.value?.sid ?? null);
const composer = computed(() => session.value?.composer ?? null);
const context = useAssistantContext(liveSid, { store });
const org = computed(() => session.value?.org ?? String(context.page.value?.org_id ?? ""));
const text = computed(() => composer.value?.text ?? "");
const images = computed(() => composer.value?.images ?? []);
const stagedChips = computed(() =>
  (composer.value?.chips ?? []).filter((chip) => chip.provenance !== "page"),
);
const attached = computed(() => stagedChips.value.length > 0 || images.value.length > 0);
// With no chips the panel header carries the ⓘ, so the strip shows it only beside chips and never beside a notice.
const chipsShown = computed(
  () => images.value.length > 0 || stagedChips.value.some((chip) => chip.kind !== "time"),
);
const seesShown = computed(() => !notice.value && chipsShown.value);
const attachNotice = computed(() => {
  const key = store.state.userOrgKey;
  if (!key || attachDismissed.value || !attached.value || replying.value) return false;
  return !readHints(key).attachSaved;
});
// A bare `@` is an unfinished mention, not a question (CT-05).
const hasContent = computed(() => /[^@\s]/.test(text.value) || attached.value);
const storageBlocked = computed(() => store.drafts.storageBlocked.value);
const ui = computed(() => composerUi(props.sid ?? ""));
const status = computed(() => (liveSid.value ? composerUi(liveSid.value).status : ui.value.status));

const turn = computed(() => session.value?.turn ?? null);
const elsewhere = computed(
  () => !!turn.value && isRunning(turn.value) && !session.value?.turnMeta.ownedByThisTab,
);
const running = computed(() => !!turn.value && isRunning(turn.value));
const replying = computed(
  () => composer.value?.mode === "reply" && !!session.value?.pendingApproval,
);
const asking = computed(() => session.value?.pendingApproval?.kind === "question");
// Reply is the one way to type under an approval card; its Enter answers the card.
const inertKind = computed<"approval" | "asking" | "consent" | null>(() => {
  if (session.value?.pendingApproval && !replying.value)
    return asking.value ? "asking" : "approval";
  return session.value?.pendingConsent ? "consent" : null;
});

// The mic and the recall sheet follow the pointer, not the width, so a narrow desktop window keeps its keyboard.
const coarse = ref(!!window.matchMedia?.("(pointer: coarse)").matches);

const voice = useAssistantVoice({
  field: el,
  ensureSid,
  draftOf: (id) => store.state.sessions[id]?.composer.text ?? null,
  writeDraft(id, value) {
    freshSendId(id);
    emptyEnterSaid = false;
    store.setDraft(id, { text: value });
  },
  blocked: () => !props.visible || !!inertKind.value || props.accessLost,
  tap: () => {
    if (props.visible && inertKind.value) assistantFocusCard();
  },
  touch: () => !mdUp.value && coarse.value,
  say,
});

// The textbox shows the unsettled tail; the draft never holds it.
const shownText = computed(() => voice.shown(text.value));

const state = computed(() => {
  if (inertKind.value) return "inert";
  if (replying.value) return "reply";
  if (props.accessLost) return "locked";
  if (turn.value?.state === "stopping") return "stopping";
  if (voice.mine.value) return "listening";
  if (elsewhere.value) return "elsewhere";
  if (running.value) return "running";
  return hasContent.value ? "draft" : "empty";
});

// The reply and Other answer rows send while the turn waits, so Send keeps its place there.
const showStop = computed(() => running.value && !elsewhere.value && !replying.value);

// After 30 s without a frame the answering line goes quiet; the clock runs only while a turn does.
const clock = ref(Date.now());
let clockTimer: ReturnType<typeof setInterval> | null = null;
watch(
  running,
  (live) => {
    if (live && !clockTimer) clockTimer = setInterval(() => (clock.value = Date.now()), 1_000);
    if (!live && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  },
  { immediate: true },
);
const stalled = computed(() => {
  const meta = session.value?.turnMeta;
  const last = meta?.lastByteAt ?? meta?.lastFrameAt ?? meta?.startedAt ?? null;
  return running.value && last !== null && clock.value - last >= STALL_MS;
});

const refusal = computed(() => (turn.value ? composerRowOf(turn.value) : null));
const refusedCode = computed(() => (turn.value?.state === "refused" ? turn.value.error : null));
const busyLeft = ref(0);
let busyTimer: ReturnType<typeof setInterval> | null = null;
const busyUntil = computed(() => {
  const error = refusal.value;
  if (!error || !BUSY_CODES.has(error.code) || !error.retryAfterMs) return 0;
  return (session.value?.turnMeta.endedAt ?? Date.now()) + error.retryAfterMs;
});
const errorRow = computed<I18nText | null>(() => {
  if (busyLeft.value > 0)
    return t("assistant.composer.busy", { product: t("assistant.name"), s: busyLeft.value });
  const error = refusal.value;
  if (!error || BUSY_CODES.has(error.code)) return null;
  if (error.code === "offline") return t("assistant.composer.offline");
  const agent = agentName(agentIdOf(error.agent) ?? shownAgent.value, t);
  return t("assistant.error.agent_unreachable.title", { agent });
});

const noAccessLine = computed(() => t("assistant.composer.noAccess"));

const creditsRefusedAbove = computed(() => isCreditsRefusal(refusedCode.value?.code));
// Out of credits keeps the draft and holds Send; image and mic stay usable (K7).
const creditsOut = computed(
  () => creditsRefusedAbove.value || store.state.capability.creditMode === "exhausted",
);

const canSend = computed(
  () =>
    voice.mine.value ||
    (hasContent.value &&
      !inertKind.value &&
      !props.accessLost &&
      (replying.value ||
        (!running.value && !props.cooldownReason && busyLeft.value === 0 && !creditsOut.value))),
);
const sendLabel = computed(() => {
  if (!replying.value)
    return shownAgent.value !== DEFAULT_AGENT
      ? t("assistant.composer.sendTo", { agent: agentLabel.value })
      : t("assistant.turn.sendLabel");
  return asking.value ? t("assistant.question.sendAnswer") : t("assistant.composer.sendReply");
});
const sendBlockedReason = computed(() => {
  if (props.accessLost) return noAccessLine.value;
  if (busyLeft.value > 0) return errorRow.value ?? undefined;
  if (props.cooldownReason) return props.cooldownReason;
  if (creditsOut.value && hasContent.value) return creditsSentence.value;
  return hasContent.value ? undefined : t("assistant.composer.sendEmpty");
});

const micOffReason = computed<I18nText | undefined>(() => {
  if (props.accessLost) return noAccessLine.value;
  if (inertKind.value) return t("assistant.composer.inert");
  return voice.offline.value && !voice.mine.value ? t("assistant.composer.offline") : undefined;
});

const shownAgent = computed(() => nextAgent(session.value));
const agentLabel = computed(() => agentName(shownAgent.value, t));

const placeholder = computed<I18nText>(() => {
  if (inertKind.value) return raw("");
  if (replying.value) return t("assistant.composer.replyPlaceholder");
  if (voice.mine.value && voice.firstUse.value) return t("assistant.voice.listeningPlaceholder");
  if (shownAgent.value !== DEFAULT_AGENT)
    return t("assistant.composer.askAgent", { agent: agentLabel.value });
  return session.value?.messages.length
    ? t("assistant.composer.followUpAt")
    : t("assistant.composer.placeholderAt");
});

const pendingLine = computed<I18nText | null>(() => {
  const next = session.value?.nextAgentId;
  return next && next !== currentAgent(session.value)
    ? t("assistant.agent.pendingSwitch", { agent: agentLabel.value })
    : null;
});

const capLine = computed(() => {
  const cap = composerUi(props.sid ?? "").cap;
  return cap && now.value - cap.at < CAP_NOTICE_MS ? cap.text : null;
});

// A door's staging into a chat that answered in the last 30 min offers a fresh chat instead (`40` §2.4).
const threadLine = computed<I18nText | null>(() => {
  const current = session.value;
  if (!current || current.messages.length === 0 || !current.title) return null;
  if (!current.composer.chips.some((chip) => chip.provenance === "door")) return null;
  const last = store.lastTurnAt(current.sid);
  return last !== null && now.value - last < THREAD_WINDOW_MS
    ? t("assistant.context.inChat", { title: current.title })
    : null;
});

const queue = useComposerQueue({
  sid: () => liveSid.value,
  running: () => running.value && !elsewhere.value,
  endedDone: () => turn.value?.state === "done",
  draft: (id) => store.state.sessions[id]?.composer.text ?? "",
  send(id, value) {
    store.setDraft(id, { text: value });
    freshSendId(id);
    void nextTick(trySend);
  },
  restore(id, value) {
    store.setDraft(id, { text: value });
    void nextTick(() => focusInput("end"));
  },
});

// A followed turn speaks once, in the shell's elsewhere row, which also knows a run this tab started before a reload (B1).
const answeringLine = computed<I18nText | null>(() => {
  if (elsewhere.value || queue.queued.value) return null;
  return running.value && hasContent.value && !stalled.value && state.value !== "stopping"
    ? t("assistant.composer.strip.enterQueues")
    : null;
});

const creditsSentence = computed(() =>
  refusedCode.value && creditsRefusedAbove.value
    ? t("assistant.error.credits_exhausted.title", { org: raw(org.value) })
    : t("assistant.credits.predictedExhausted", { org: raw(org.value) }),
);

const pasteLine = computed(() => t("assistant.context.pastedAsChip"));

const cleared = computed(() => {
  const notice = ui.value.cleared;
  return notice && now.value - notice.at < UNDO_WINDOW_MS ? notice : null;
});
const clearedText = computed<I18nText | null>(() => {
  const notice = cleared.value;
  if (!notice) return null;
  if (notice.from) {
    const title = store.state.sessions[notice.from]?.title;
    return title
      ? t("assistant.composer.draftStayed", { chat: title })
      : t("assistant.composer.draftStayedUnnamed");
  }
  return notice.token
    ? t("assistant.composer.cleared")
    : t("assistant.composer.clearedOrg", { org: raw(notice.org) });
});

// Go to request is offered only while the card is out of view, as the card itself is the way back otherwise.
const cardAway = ref(false);
watch(
  [inertKind, root, () => session.value?.pendingApproval?.id, () => session.value?.pendingConsent],
  ([kind], _, onCleanup) => {
    cardAway.value = false;
    const cards = kind ? Array.from(shellRoot()?.querySelectorAll(CARD_SELECTOR) ?? []) : [];
    if (cards.length === 0 || typeof IntersectionObserver === "undefined") return;
    const shown = new Map<Element, boolean>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) shown.set(entry.target, entry.isIntersecting);
      cardAway.value = ![...shown.values()].some(Boolean);
    });
    cards.forEach((card) => observer.observe(card));
    onCleanup(() => observer.disconnect());
  },
  { flush: "post" },
);

provide(
  composerLayoutKey,
  computed(() => ({
    narrow: width.narrow.value,
    tight: width.tight.value,
    wide: width.wide.value,
  })),
);

const holdNotice = computed<ComposerNotice | null>(() => {
  if (prefillPending.value)
    return {
      id: "prefill",
      tone: "info",
      title: t("assistant.composer.strip.replaceDraft"),
      sentence: t("assistant.welcome.prefill.question"),
      links: [
        { action: "prefillReplace", label: t("assistant.welcome.prefill.replace") },
        { action: "prefillAppend", label: t("assistant.welcome.prefill.append") },
        { action: "prefillCancel", label: t("assistant.welcome.prefill.cancel") },
      ],
    };
  if (inertKind.value) {
    const title =
      inertKind.value === "asking"
        ? t("assistant.composer.inertAnswer")
        : t("assistant.composer.strip.decideAbove");
    const links = cardAway.value
      ? [{ action: "goToRequest" as const, label: t("assistant.composer.goToRequest") }]
      : [];
    return { id: "inert", tone: "paused", title, sentence: title, links };
  }
  if (replying.value) {
    const title = asking.value
      ? t("assistant.question.answerHint")
      : t("assistant.composer.replyHelper");
    const links = [{ action: "replyCancel" as const, label: t("assistant.composer.replyCancel") }];
    return { id: "reply", tone: "info", title, sentence: title, links };
  }
  if (!props.accessLost) return null;
  return {
    id: "access",
    tone: "warning",
    title: t("assistant.composer.strip.needsAccess"),
    sentence: noAccessLine.value,
    links: [{ action: "askAdmin", label: t("assistant.gate.noPermission.askAdmin") }],
  };
});

const voiceNotice = computed<ComposerNotice | null>(() => {
  if (offOffer.value)
    return sentenceNotice("voice", t("assistant.voice.offAdmin"), "info", [
      { action: "turnOn", label: t("assistant.voice.turnOn") },
    ]);
  if (voice.waiting.value)
    return sentenceNotice("voice", t("assistant.voice.waitingPermission"), "info");
  const line = voice.helperLine.value;
  if (!line) return null;
  if (voice.action.value === "how") {
    const help = micHelpUrl(voice.brand());
    return {
      id: "voice",
      tone: "warning",
      title: t("assistant.composer.strip.micBlocked"),
      sentence: line,
      links: help ? [{ action: "micHelp", label: t("assistant.composer.strip.howToAllow") }] : [],
    };
  }
  const links =
    voice.action.value === "retry"
      ? [{ action: "voiceRetry" as const, label: t("assistant.voice.tryAgain") }]
      : [];
  return sentenceNotice("voice", line, voice.failure.value ? "warning" : "info", links);
});

const refusalNotice = computed<ComposerNotice | null>(() => {
  if (busyLeft.value > 0 && errorRow.value)
    return {
      id: "busy",
      tone: "warning",
      title: t("assistant.composer.strip.busyFor", { s: busyLeft.value }),
      sentence: errorRow.value,
      links: [],
    };
  const error = refusedCode.value;
  const sentence = () => {
    const { key, params } = errorTitle(error!, { org: org.value, product: t("assistant.name"), t });
    return t(key, params);
  };
  if (error?.code === "run_limit_member")
    return {
      id: "runLimit",
      tone: "warning",
      title: t("assistant.composer.strip.runLimit"),
      sentence: sentence(),
      links: [{ action: "showRunning", label: t("assistant.composer.strip.showRunning") }],
    };
  if (error?.code === "run_limit_org")
    return {
      id: "orgBusy",
      tone: "warning",
      title: t("assistant.composer.strip.orgBusy"),
      sentence: sentence(),
      links: [{ action: "retry", label: t("assistant.composer.strip.retry") }],
    };
  return null;
});

const stateNotice = computed<ComposerNotice | null>(() => {
  if (creditsOut.value)
    return {
      id: "credits",
      tone: "warning",
      title: t("assistant.composer.strip.creditsOut"),
      sentence: creditsSentence.value,
      links: billingHrefOf(router, org.value)
        ? [{ action: "manageUsage", label: t("assistant.composer.strip.managePaid") }]
        : [],
    };
  const offline =
    errorRow.value === t("assistant.composer.offline") || (voice.show.value && voice.offline.value);
  if (offline)
    return {
      id: "offline",
      tone: "warning",
      title: t("assistant.composer.strip.offline"),
      sentence: t("assistant.composer.offline"),
      links: [],
    };
  return errorRow.value ? sentenceNotice("unreachable", errorRow.value) : null;
});

const draftNotice = computed<ComposerNotice | null>(() => {
  if (capLine.value) return sentenceNotice("cap", capLine.value);
  if (clearedText.value) {
    const notice = cleared.value;
    const links: ComposerNotice["links"] = notice?.from
      ? [{ action: "bringDraft", label: t("assistant.composer.bringDraft") }]
      : notice?.token
        ? [{ action: "undo", label: t("assistant.composer.undo") }]
        : [];
    return sentenceNotice("cleared", clearedText.value, "info", links);
  }
  if (queue.queued.value)
    return {
      id: "queued",
      tone: "info",
      title: t("assistant.composer.queued", { count: 1 }),
      sentence: t("assistant.composer.queuedSentence"),
      links: [{ action: "editQueued", label: t("assistant.composer.queuedEdit") }],
    };
  const entry = liveSid.value ? store.entryNotice(liveSid.value) : null;
  if (entry) return sentenceNotice("entry", t(entry), "info");
  return null;
});

const offerNotice = computed<ComposerNotice | null>(() => {
  const offer = pasteOffer.value;
  if (offer) {
    const lines = lineCount(offer.text);
    return {
      id: "paste",
      tone: "info",
      title: t("assistant.composer.strip.pastedLines", { count: lines }, lines),
      sentence: pasteLine.value,
      links: [{ action: "pasteInline", label: t("assistant.composer.strip.pasteInline") }],
    };
  }
  if (droppedImages.value > 0)
    return sentenceNotice(
      "dropped",
      t("assistant.composer.imagesDropped", { count: droppedImages.value }, droppedImages.value),
      "info",
    );
  if (attachNotice.value)
    return sentenceNotice("attach", t("assistant.attach.saved"), "info", [
      { action: "attachOk", label: t("assistant.attach.ok") },
    ]);
  return null;
});

const quietNotice = computed<ComposerNotice | null>(() => {
  if (answeringLine.value) return sentenceNotice("answering", answeringLine.value, "info");
  if (pendingLine.value) return sentenceNotice("pending", pendingLine.value, "info");
  if (!threadLine.value) return null;
  return sentenceNotice("thread", threadLine.value, "info", [
    { action: "startNew", label: t("assistant.context.startNew") },
  ]);
});

// Beside chips this line sits in the ⓘ; an empty strip says it itself, as the header ⓘ does not carry it.
const storageNotice = computed<ComposerNotice | null>(() =>
  storageBlocked.value && !chipsShown.value
    ? sentenceNotice("storage", t("assistant.client.storageBlocked"), "info")
    : null,
);

// One line at a time in the strip; the chips come back once nothing needs saying.
const notice = computed(() =>
  pickNotice([
    holdNotice.value,
    voiceNotice.value,
    blockedLine.value && sentenceNotice("blocked", blockedLine.value),
    refusalNotice.value,
    stateNotice.value,
    draftNotice.value,
    offerNotice.value,
    quietNotice.value,
    storageNotice.value,
  ]),
);

const textboxAttrs = computed(() => ({
  "aria-label": t("assistant.composer.name", { product: t("assistant.name") }),
  "aria-multiline": "true",
  "aria-placeholder": placeholder.value,
  "aria-describedby": notice.value ? noticeId : undefined,
  "aria-disabled": inertKind.value ? "true" : undefined,
  "aria-readonly": inertKind.value ? "true" : undefined,
  // A textarea cannot be a combobox, so there is no `aria-expanded`; the menu's state is spoken instead.
  "aria-autocomplete": "list",
  "aria-controls": mentionAt.value !== null ? listboxId : undefined,
  "aria-activedescendant": mentionAt.value !== null ? mention.value?.activeId : undefined,
  "data-assistant-composer": "",
  class: [
    "max-md:min-h-11 pointer-coarse:min-h-11",
    inertKind.value ? "text-text-muted!" : "",
  ].join(" "),
}));

/** Puts the caret at the end or at an offset (CT-08 AC 9; `70` landing rules). */
function focusInput(caret: "end" | number = "end"): void {
  const target = el();
  if (!target) return;
  target.focus({ preventScroll: true });
  const at = caret === "end" ? target.value.length : Math.min(caret, target.value.length);
  target.setSelectionRange(at, at);
  // Focus skips scrolling, and a restored draft past the row cap would hide its caret below the fold.
  if (at === target.value.length)
    requestAnimationFrame(() => (target.scrollTop = target.scrollHeight));
}

function say(line: I18nText): void {
  if (props.visible && liveSid.value) announceComposer(liveSid.value, line);
}

function clearBlocked(): void {
  blockedLine.value = null;
}

function emphasise(line: I18nText): void {
  blockedLine.value = line;
}

// The first keystroke of an org that has no chat yet starts one; mount never does (`00` §4.2 rule 2).
function ensureSid(): Sid | null {
  if (liveSid.value) return liveSid.value;
  if (!store.state.ready) return null;
  return store.createSession({
    origin: {
      entryKind: "empty_state",
      objectKind: "none",
      container: placement.container.value ?? "sidebar",
    },
  });
}

function onInput(value: string): void {
  if (inertKind.value) return;
  const id = ensureSid();
  if (!id) return;
  voice.noteEdit(el()?.selectionStart ?? value.length);
  blockedLine.value = null;
  droppedImages.value = 0;
  pasteOffer.value = null;
  offOffer.value = false;
  freshSendId(id);
  emptyEnterSaid = false;
  // Typing in the new chat ends the Undo offer, so Undo never replaces new work (U9).
  if (ui.value.cleared) composerUi(props.sid ?? id).cleared = null;
  store.setDraft(id, { text: value });
  void nextTick(detectMention);
}

// `@` opens the menu only at a word boundary, so `ops@acme.com` stays text (CT-05 AC 7).
function detectMention(): void {
  const target = el();
  if (!target) return closeMention();
  const caret = target.selectionStart ?? 0;
  const before = target.value.slice(0, caret);
  const start = Math.max(before.lastIndexOf(" "), before.lastIndexOf("\n")) + 1;
  const token = before.slice(start);
  if (!token.startsWith("@") || /\s/.test(token)) return closeMention();
  mentionAt.value = start;
  mentionQuery.value = token.slice(1);
}

// A caret moved by a click or a navigation key re-reads the token under it, so the menu follows the caret (V2).
function onCaretKey(event: KeyboardEvent): void {
  if (CARET_KEYS.has(event.key) && mentionAt.value !== null) detectMention();
}

// Below md the panel sits in the flow, so closing it mid-press would move the control being pressed; it closes after the click.
function onBlur(): void {
  if (mentionAt.value === null) return;
  if (!pointerDown) return closeMention();
  cancelDeferredClose?.();
  const done = () => {
    cancelDeferredClose?.();
    setTimeout(closeMention, 0);
  };
  window.addEventListener("pointerup", done);
  window.addEventListener("pointercancel", done);
  cancelDeferredClose = () => {
    window.removeEventListener("pointerup", done);
    window.removeEventListener("pointercancel", done);
    cancelDeferredClose = null;
  };
}

function tokenEnd(value: string, at: number): number {
  const rest = value.slice(at).search(/\s/);
  return rest === -1 ? value.length : at + rest;
}

function closeMention(): void {
  mentionAt.value = null;
  mentionQuery.value = "";
}

function pickMention(option: MentionOption): void {
  const id = liveSid.value ?? ensureSid();
  const at = mentionAt.value;
  const target = el();
  closeMention();
  if (!id || at === null) return;
  const mixed = mixedStreamType(option);
  if (mixed) return capHit("type", t("assistant.context.mixedStreams", { type: raw(mixed) }));
  const caret = target?.selectionStart ?? text.value.length;
  const end = tokenEnd(text.value, at);
  // Only a caret inside the `@` token may edit; the pick replaces the whole token, never leaving its tail (V2, W1).
  if (text.value[at] !== "@" || caret <= at || caret > end) return;
  // A chip refused at the cap leaves the typed token in place, so the user loses neither.
  if (!applyOption(id, option)) return;
  store.setDraft(id, { text: text.value.slice(0, at) + text.value.slice(end) });
  void nextTick(() => focusInput(at));
}

// Adds the option's chip; false when a cap refused it.
function applyOption(id: Sid, option: MentionOption): boolean {
  if (option.chip) {
    const result = store.addChip(id, option.chip);
    if (!result.ok) {
      capHit(result.cap === "rows" ? "rows" : "bytes");
      return false;
    }
  }
  say(t("assistant.context.added", { label: option.label }));
  trackAssistant("ai_context_changed", {
    action: "mention",
    kind: option.kind,
    count: 1,
    bytes: option.chip?.sizeBytes ?? 0,
  });
  return true;
}

// One stream type per request (F5): a stream of another type than the ones in context is refused in place.
function mixedStreamType(option: MentionOption): string | null {
  if (option.kind !== "stream") return null;
  const type = option.chip?.ref?.streamType ?? "logs";
  const page = context.page.value;
  const removed = composer.value?.removedPageKeys.includes("selectedStreams");
  const pageType = !removed && page?.selectedStreams?.length ? (page.streamType ?? "logs") : null;
  const mentioned = stagedChips.value.find((chip) => chip.kind === "stream")?.ref?.streamType;
  const current = pageType ?? mentioned ?? null;
  return current && current !== type ? current : null;
}

function caretOnFirstLine(target: HTMLTextAreaElement): boolean {
  return !target.value.slice(0, target.selectionStart ?? 0).includes("\n");
}

function caretOnLastLine(target: HTMLTextAreaElement): boolean {
  return !target.value.slice(target.selectionEnd ?? 0).includes("\n");
}

// The one `keydown` owner (`40` §1.4); a composing IME key is never ours.
function onKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.keyCode === 229) return;
  voice.clearHint();
  if (mentionAt.value !== null && mentionKey(event)) return;
  const target = el();
  if (!target) return;
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (voice.mine.value) return voice.stop("enter");
    return void trySend();
  }
  // Ctrl+↑ / ⌘↑ on the first line goes to the latest answer; elsewhere the native caret move runs (round 2 X-28).
  if (
    event.key === "ArrowUp" &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    caretOnFirstLine(target)
  ) {
    if (assistantGoToAnswer()) event.preventDefault();
    return;
  }
  if (
    event.key === "ArrowUp" &&
    target.selectionStart === target.selectionEnd &&
    caretOnFirstLine(target)
  ) {
    if (recall("older")) event.preventDefault();
    return;
  }
  if (
    event.key === "ArrowDown" &&
    caretOnLastLine(target) &&
    (composer.value?.recallIndex ?? -1) > -1
  ) {
    event.preventDefault();
    return void recall("newer");
  }
  if (event.key === "Backspace" && !target.value && target.selectionStart === 0) {
    if (focusLastChip()) event.preventDefault();
  }
}

function mentionKey(event: KeyboardEvent): boolean {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    mention.value?.move(event.key === "ArrowDown" ? 1 : -1);
    return true;
  }
  const plain = !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
  if ((event.key === "Home" || event.key === "End") && plain) {
    event.preventDefault();
    mention.value?.edge(event.key === "Home" ? "first" : "last");
    return true;
  }
  if (event.key === "Enter" || event.key === "Tab") {
    // A caret moved by a key or touch this menu never saw (Ctrl+E, Cmd+→, a drag) leaves the token; the key then does its own job (W1).
    detectMention();
    if (mentionAt.value === null) return false;
    const option = mention.value?.current();
    if (!option) {
      if (event.key !== "Enter") return false;
      // A swallowed Enter says why (CT-09 AC 10); the literal `@query` stays as text (CT-05 AC 5).
      event.preventDefault();
      if (mentionTimer) clearTimeout(mentionTimer);
      say(t("assistant.composer.mention.empty", { q: mentionQuery.value }));
      return true;
    }
    event.preventDefault();
    if (option.action) mention.value?.choose(option);
    else pickMention(option);
    return true;
  }
  if (event.key === "Escape") {
    // Only the menu closes: the ladder never sees this Escape (CT-05 AC 6).
    event.preventDefault();
    event.stopPropagation();
    closeMention();
    return true;
  }
  return false;
}

function trySend(): void {
  if (voice.mine.value) return voice.stop("send");
  const id = liveSid.value;
  if (!id || !composer.value) return;
  if (inertKind.value) {
    trackAssistant("ai_composer_enter_blocked", { reason: "inert" });
    return say(holdNotice.value?.sentence ?? t("assistant.composer.inert"));
  }
  if (replying.value) {
    if (props.accessLost) return say(noAccessLine.value);
    if (hasContent.value) return void sendReply(id);
    if (!emptyEnterSaid) say(t("assistant.composer.sendEmpty"));
    emptyEnterSaid = true;
    return;
  }
  if (props.accessLost) return say(noAccessLine.value);
  if (busyLeft.value > 0 && errorRow.value) return say(errorRow.value);
  if (props.cooldownReason) {
    if (blockedLine.value !== props.cooldownReason) say(props.cooldownReason);
    return emphasise(props.cooldownReason);
  }
  if (running.value) return queueOrHold(id);
  if (creditsOut.value && hasContent.value) return say(creditsSentence.value);
  if (!hasContent.value) {
    trackAssistant("ai_composer_enter_blocked", { reason: "empty" });
    // Once per run of empty Enters, so a held key does not repeat it (CT-09 AC 10).
    if (!emptyEnterSaid) say(t("assistant.composer.sendEmpty"));
    emptyEnterSaid = true;
    return;
  }
  const sendId = composer.value.sendId;
  if (usedSendIds.has(sendId)) return;
  usedSendIds.add(sendId);
  blockedLine.value = null;
  pasteOffer.value = null;
  void store
    .send(id)
    .then((result) => onRefused(id, sendId, result))
    .finally(refreshRecall);
}

// Enter while this tab's answer streams queues one message; a second one, or a run in another tab, waits instead.
function queueOrHold(id: Sid): void {
  if (!elsewhere.value && hasContent.value && queue.enqueue(text.value)) {
    store.setDraft(id, { text: "" });
    return say(t("assistant.composer.queued", { count: 1 }));
  }
  trackAssistant("ai_composer_enter_blocked", {
    reason: elsewhere.value ? "elsewhere" : "running",
  });
  const line = t("assistant.composer.running");
  if (blockedLine.value !== line) say(line);
  emphasise(line);
}

// A cross-tab lock that landed between render and click refuses the send; the draft stays and the same click works once it lifts.
function onRefused(id: Sid, sendId: string, result: TurnTerminal): void {
  const lock = result.state === "refused" ? store.turnLockOf(id) : null;
  if (!lock) return;
  usedSendIds.delete(sendId);
  const line = t(turnLockKey(lock));
  if (blockedLine.value !== line) say(line);
  emphasise(line);
}

// A sent draft keeps its id until it is edited or its turn ends, so a repeated Enter is one send.
function freshSendId(id: Sid): void {
  const current = store.state.sessions[id]?.composer.sendId;
  if (current && usedSendIds.has(current)) store.setDraft(id, { sendId: getUUIDv7() });
}

// The reply stays in the box until the card takes it; a refused one stays, with the reason spoken.
async function sendReply(id: Sid): Promise<void> {
  const approval = composer.value?.replyApprovalId;
  if (!approval) return;
  const reply = text.value;
  await store.decideApproval(id, { approved: false, reason: "reply", reply }, approval);
  if (store.state.sessions[id]?.pendingApproval?.id === approval)
    say(t("assistant.composer.replyRefused"));
}

function leaveReply(): void {
  if (liveSid.value) store.cancelReply(liveSid.value);
  void nextTick(async () => {
    const reply = () => shellRoot()?.querySelector<HTMLElement>(REPLY_SELECTOR) ?? null;
    if (!reply()) await nextTick();
    const target = reply();
    if (target) target.focus();
    else if (!assistantFocusCard()) focusInput("end");
  });
}

function goToRequest(): void {
  assistantFocusCard();
}

// Stop turns into Send, so the textbox takes focus rather than the page (HT-04 AC 3).
function stop(): void {
  if (liveSid.value) void store.stop(liveSid.value);
  void nextTick(() => focusInput("end"));
}

function recall(direction: "older" | "newer"): boolean {
  voice.stop("other");
  const id = liveSid.value ?? ensureSid();
  const key = store.state.userOrgKey;
  if (!id || !key) return false;
  const before = store.state.sessions[id]?.composer.recallIndex ?? -1;
  store.recall(id, direction);
  const after = store.state.sessions[id]?.composer.recallIndex ?? -1;
  if (after === before) return false;
  trackAssistant("ai_composer_recall", { direction, index: after });
  if (after >= 0)
    say(t("assistant.composer.recalled", { n: after + 1, count: readRecall(key).length }));
  void nextTick(() => focusInput("end"));
  return true;
}

function pickRecall(index: number): void {
  const id = ensureSid();
  const entry = recallEntries.value[index];
  recallPicked = true;
  recallOpen.value = false;
  void nextTick(() => (recallPicked = false));
  if (!id || !entry) return;
  store.stage(id, {
    text: entry.text,
    chips: entry.chips,
    mode: hasContent.value ? "append" : "replace",
  });
  trackAssistant("ai_composer_recall", { direction: "older", index });
  say(t("assistant.composer.recalled", { n: index + 1, count: recallEntries.value.length }));
  void nextTick(() => focusInput("end"));
}

function refreshRecall(): void {
  const key = store.state.userOrgKey;
  recallEntries.value = key ? readRecall(key) : [];
}

// Backspace in an empty textbox focuses the last chip; a second key removes it (CT-08 AC 5).
function focusLastChip(): boolean {
  const scope = root.value?.closest("[data-assistant-root]") ?? document;
  const removable = Array.from(scope.querySelectorAll<HTMLElement>("[data-assistant-chip]")).filter(
    (chip) => chip.querySelector('[data-test="assistant-context-chip-remove"]'),
  );
  const button = removable
    .at(-1)
    ?.querySelector<HTMLElement>('[data-test="assistant-context-chip-button"]');
  button?.focus();
  return !!button;
}

/** A starter's prompt: replaces an empty draft, appends to a short one, asks over a long one (IW-06 AC 5). */
function prefill(payload: { text: string; chips: ContextChip[]; homeStarter?: boolean }): void {
  const id = ensureSid();
  if (!id) return;
  if (text.value.length > PREFILL_CHOICE_CHARS) {
    prefillPending.value = payload;
    // The banner answers a click, so focus moves to it and its Escape is Cancel (IW-06 AC 5, U19).
    void nextTick(() =>
      root.value
        ?.querySelector<HTMLElement>('[data-test="assistant-composer-notice-prefillAppend"]')
        ?.focus(),
    );
    return;
  }
  store.stage(id, { ...payload, mode: text.value.trim() ? "append" : "replace" });
  void nextTick(() => focusInput("end"));
}

function resolvePrefill(choice: "replace" | "append" | null): void {
  const payload = prefillPending.value;
  prefillPending.value = null;
  const id = liveSid.value;
  if (payload && id && choice) store.stage(id, { ...payload, mode: choice });
  void nextTick(() => focusInput("end"));
}

function undoClear(): void {
  const id = liveSid.value;
  const notice = cleared.value;
  if (!id || !notice) return;
  if (notice.from) moveDraft(store, notice.from, id);
  else if (notice.token) store.undoClear(id, notice.token);
  else return;
  composerUi(props.sid ?? id).cleared = null;
  trackAssistant("ai_composer_cleared", { reason: "new_chat", undone: true });
  void nextTick(() => focusInput("end"));
}

function capHit(cap: "rows" | "bytes" | "images" | "type" | "size", line?: I18nText): void {
  const id = liveSid.value;
  trackAssistant("ai_composer_cap_hit", { cap });
  const sentence =
    line ??
    (cap === "images"
      ? t("assistant.context.capImages", {
          count: MAX_IMAGES,
          size: raw(formatBytes(MAX_IMAGE_SIZE_BYTES)),
        })
      : t("assistant.context.capRows", { rows: 20, size: raw(formatBytes(32 * 1024)) }));
  if (id && props.visible) noteCap(id, sentence);
}

function imageCapLine(name: string): I18nText {
  return t("assistant.composer.imageCap", {
    name: raw(name),
    count: MAX_IMAGES,
    size: raw(formatBytes(MAX_IMAGE_SIZE_BYTES)),
  });
}

function refuse(cap: "type" | "size" | "images", line: I18nText): void {
  capHit(cap, line);
}

function refuseSize(picked: File): void {
  refuse(
    "size",
    t("assistant.composer.imageTooBig", {
      name: raw(picked.name),
      size: raw(formatBytes(picked.size)),
      count: MAX_IMAGES,
      max: raw(formatBytes(MAX_IMAGE_SIZE_BYTES)),
    }),
  );
}

function openPicker(): void {
  file.value?.open();
}

function onPicked(value: FileValue): void {
  const files = Array.isArray(value) ? value : value ? [value] : [];
  void addFiles(files).then(() => focusInput("end"));
}

function onPaste(event: ClipboardEvent): void {
  const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
    f.type.startsWith("image/"),
  );
  if (files.length === 0) return void pasteLong(event);
  if (!event.clipboardData?.getData("text")) event.preventDefault();
  void addFiles(files, true);
}

// A long paste rides as a chip; one over the attached-data cap falls through to the textbox as typed text.
function pasteLong(event: ClipboardEvent): void {
  const pasted = event.clipboardData?.getData("text/plain") ?? "";
  if (inertKind.value || replying.value || !isLongPaste(pasted)) return;
  const id = ensureSid();
  if (!id) return;
  const chip = pastedTextChip(pasted, getUUIDv7(), t);
  const result = store.addChip(id, chip);
  if (!result.ok) return capHit(result.cap === "rows" ? "rows" : "bytes");
  event.preventDefault();
  pasteOffer.value = {
    chipId: chip.id,
    text: pasted,
    at: el()?.selectionStart ?? text.value.length,
  };
  say(t("assistant.context.added", { label: chip.label }));
  trackAssistant("ai_context_changed", {
    action: "add",
    kind: "pasted_text",
    count: 1,
    bytes: chip.sizeBytes,
  });
}

/** "Paste into the message instead": the chip goes and its text lands where the caret was. */
function pasteInline(): void {
  const id = liveSid.value;
  const offer = pasteOffer.value;
  pasteOffer.value = null;
  if (!id || !offer) return;
  store.removeChip(id, offer.chipId);
  const at = Math.min(offer.at, text.value.length);
  store.setDraft(id, { text: text.value.slice(0, at) + offer.text + text.value.slice(at) });
  void nextTick(() => focusInput(at + offer.text.length));
}

// Pasted shots share one browser name, so each gets the next free `pasted-image-{n}.png` of this draft (CT-10 AC 1).
function pastedName(): string {
  const used = images.value
    .map((image) => /^pasted-image-(\d+)\.png$/.exec(image.filename)?.[1])
    .filter((n): n is string => !!n)
    .map(Number);
  return `pasted-image-${(used.length ? Math.max(...used) : 0) + 1}.png`;
}

async function addFiles(files: File[], pasted = false): Promise<void> {
  const id = ensureSid();
  if (!id) return;
  for (const picked of files) {
    if (picked.type !== "image/png" && picked.type !== "image/jpeg") {
      refuse("type", t("assistant.context.imageType"));
      continue;
    }
    if (picked.size > MAX_IMAGE_SIZE_BYTES) {
      refuseSize(picked);
      continue;
    }
    const data = await readBase64(picked).catch(() => null);
    if (data === null) {
      refuse("type", t("assistant.composer.imageReadFailed", { name: raw(picked.name) }));
      continue;
    }
    const filename = pasted ? pastedName() : picked.name;
    const result = store.addImage(id, { data, mimeType: picked.type, filename, size: picked.size });
    if (!result.ok) {
      capHit(result.cap === "images" ? "images" : result.cap, imageCapLine(filename));
      break;
    }
  }
}

function readBase64(picked: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(picked);
  });
}

// A keyboard press has `detail` 0 and keeps focus on the mic, so Enter or Space stops it (D4 §4.3).
function onMicPress(event: MouseEvent): void {
  if (voice.mic.value === "off") {
    offOffer.value = true;
    return;
  }
  voice.press("mic");
  if (event.detail > 0) el()?.focus({ preventScroll: true });
}

function turnOnVoice(): void {
  offOffer.value = false;
  voice.turnOn();
}

function openHref(href: string | null): void {
  if (href) openTabWithoutOpener(href);
}

function editQueued(): void {
  queue.edit();
}

function retryRefused(): void {
  if (liveSid.value) void store.retry(liveSid.value);
}

const NOTICE_HANDLERS: Record<NoticeAction, () => void> = {
  prefillReplace: () => resolvePrefill("replace"),
  prefillAppend: () => resolvePrefill("append"),
  prefillCancel: () => resolvePrefill(null),
  goToRequest: () => goToRequest(),
  replyCancel: () => leaveReply(),
  askAdmin: () => undefined,
  micHelp: () => openHref(micHelpUrl(voice.brand())),
  voiceRetry: () => voice.retry(),
  turnOn: turnOnVoice,
  showRunning: () => emit("show-running"),
  retry: retryRefused,
  manageUsage: () => openHref(billingHrefOf(router, org.value)),
  undo: () => undoClear(),
  bringDraft: () => undoClear(),
  editQueued,
  pasteInline: () => pasteInline(),
  attachOk: () => dismissAttachNotice(),
  startNew: () => startNew(),
};

function onNoticeAction(action: NoticeAction): void {
  NOTICE_HANDLERS[action]();
}

function dismissAttachNotice(): void {
  attachDismissed.value = true;
  const key = store.state.userOrgKey;
  if (key) markHintSeen(key, "attachSaved");
  void nextTick(() => focusInput("end"));
}

// The whole staged payload moves, so the new chat sends exactly what this one would have (S8).
function startNew(): void {
  const current = session.value;
  if (!current) return;
  const fresh = store.createSession({ origin: { ...current.origin }, thread: "new" });
  moveDraft(store, current.sid, fresh);
}

// Drops anywhere on the container land in the strip, with an outline on the whole body while dragging (CT-10 AC 6).
function shellRoot(): HTMLElement | null {
  return root.value?.closest<HTMLElement>("[data-assistant-root]") ?? null;
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function onDragOver(event: DragEvent): void {
  if (!hasFiles(event)) return;
  event.preventDefault();
  const shell = shellRoot();
  if (shell) shell.dataset.dragging = "";
}

function onDragLeave(event: DragEvent): void {
  const shell = shellRoot();
  if (shell && !shell.contains(event.relatedTarget as Node | null)) delete shell.dataset.dragging;
}

function onDrop(event: DragEvent): void {
  const shell = shellRoot();
  if (shell) delete shell.dataset.dragging;
  if (!hasFiles(event)) return;
  event.preventDefault();
  void addFiles(Array.from(event.dataTransfer?.files ?? []));
}

watch(
  () => turn.value && !isRunning(turn.value) && turn.value.state !== "idle",
  (ended) => {
    if (!ended) return;
    if (liveSid.value) freshSendId(liveSid.value);
    clearBlocked();
  },
);

// The offer names one chip; once that chip is gone (removed in the tray, sent) there is nothing to paste back.
watch(
  () => composer.value?.chips.some((chip) => chip.id === pasteOffer.value?.chipId),
  (present) => {
    if (!present) pasteOffer.value = null;
  },
);

// Stop goes when its turn ends, and a focused Stop would drop focus on the page (HT-04 AC 3).
watch(
  showStop,
  (shown) => {
    if (!shown && root.value?.contains(document.activeElement))
      if (document.activeElement?.matches('[data-test="assistant-stop"]')) focusInput("end");
  },
  { flush: "pre" },
);

// A reason for a swallowed Enter is true only while its cause lasts (U8).
watch(inertKind, (kind) => {
  if (kind === null) return clearBlocked();
  voice.stop("other");
  closeMention();
});

// A cap's sentence leaves on its own after 6 s; `now` has to tick for that.
watch(
  () => composerUi(props.sid ?? "").cap?.at,
  (at) => {
    if (at === undefined) return;
    now.value = Date.now();
    if (capTimer) clearTimeout(capTimer);
    capTimer = setTimeout(() => (now.value = Date.now()), CAP_NOTICE_MS);
  },
);

watch(
  busyUntil,
  (until) => {
    if (busyTimer) clearInterval(busyTimer);
    busyTimer = null;
    const tick = () => {
      busyLeft.value = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      if (busyLeft.value === 0 && busyTimer) clearInterval(busyTimer);
    };
    tick();
    if (busyLeft.value > 0) busyTimer = setInterval(tick, 1_000);
  },
  { immediate: true },
);

// The original chat keeps what was dictated: a switch, a hide or an org change settles there (`40` §1.8.3).
watch(liveSid, (id, previous) => {
  if (previous && id !== previous) voice.stop("other");
});
watch(
  () => props.visible,
  (visible) => {
    if (!visible) voice.stop("other");
  },
);

// Writing the textbox's value moves the caret to the end, so the caret is put back where the user had it.
watch(
  [shownText, voice.anchor],
  (_, [, anchorBefore]) => {
    const field = el();
    if (!field || !voice.mine.value || document.activeElement !== field) return;
    const caret = field.selectionStart ?? 0;
    const fromEnd = field.value.length - caret;
    void nextTick(() => {
      const at = caret < anchorBefore ? caret : field.value.length - fromEnd;
      field.setSelectionRange(at, at);
    });
  },
  { flush: "pre" },
);

// A card answered or withdrawn elsewhere takes reply mode with it.
watch(
  () => !!session.value?.pendingApproval,
  (pending) => {
    if (!pending && composer.value?.mode === "reply" && liveSid.value)
      store.cancelReply(liveSid.value);
  },
);

// The menu is silent by role on a textarea, so its result count is spoken once per query (U7).
watch(
  () => [
    mentionAt.value !== null,
    mentionQuery.value,
    mention.value?.results,
    mention.value?.empty,
    mention.value?.loading,
  ],
  ([open]) => {
    if (mentionTimer) clearTimeout(mentionTimer);
    if (!open) return;
    mentionTimer = setTimeout(() => {
      const menu = mention.value;
      if (!menu || mentionAt.value === null || menu.loading) return;
      if (menu.empty) say(t("assistant.composer.mention.empty", { q: mentionQuery.value }));
      else if (menu.results > 0)
        say(t("assistant.composer.mention.count", { count: menu.results }, menu.results));
    }, MENTION_ANNOUNCE_MS);
  },
);

// Any edit in this chat (a chip, a time, an image, a removed field) ends the offer, as typing does (U9, V6).
const draftShape = computed(() => {
  const c = composer.value;
  if (!c) return "";
  const images = c.images.map((image) => image.id ?? image.filename);
  return JSON.stringify([
    c.chips.map((chip) => chip.id),
    images,
    c.timeOverride,
    c.removedPageKeys,
  ]);
});
watch([() => composer.value, draftShape, cleared], ([draft, shape, notice], previous) => {
  const id = props.sid ?? liveSid.value;
  const [wasDraft, wasShape, wasNotice] = previous ?? [];
  if (!notice || !wasNotice || draft !== wasDraft || shape === wasShape || !id) return;
  composerUi(id).cleared = null;
});

// A draft restored from storage is announced once, and the images it could not keep are named (CT-06 AC 3).
watch(
  [liveSid, () => props.visible],
  ([id, visible]) => {
    if (!id || !visible) return;
    const restored = store.takeRestoredDraft(id);
    if (!restored) return;
    say(t("assistant.composer.draftRestored"));
    droppedImages.value = restored.imageCount;
  },
  { immediate: true },
);

// An org switch clears the old org's draft for good and says so, with no Undo across orgs (CT-06 AC 6).
watch(
  () => store.state.userOrgKey,
  (next, previous) => {
    voice.stop("other");
    const old = ownSession.value;
    // Every mounted composer may clear (the first one wins), so a closed assistant still forgets the draft.
    if (!old || !previous || next === previous || old.userOrgKey !== previous) return;
    const { text: oldText, chips, images: oldImages } = old.composer;
    if (!oldText.trim() && chips.length === 0 && oldImages.length === 0) return;
    store.clearDraft(old.sid, "org_switch");
    store.drafts.remove(previous, old.sid);
    noteDraftCleared(old.sid, { token: null, org: old.org, at: Date.now() });
    trackAssistant("ai_composer_cleared", { reason: "org_switch", undone: false });
  },
);

watch(
  () => ui.value.cleared?.at,
  (at) => {
    if (at === undefined) return;
    now.value = Date.now();
    if (clearedTimer) clearTimeout(clearedTimer);
    clearedTimer = setTimeout(() => {
      now.value = Date.now();
      // A spent notice is dropped, so a later one can show.
      const notice = ui.value.cleared;
      if (notice && now.value - notice.at >= UNDO_WINDOW_MS) ui.value.cleared = null;
    }, UNDO_WINDOW_MS);
  },
  { immediate: true },
);

// A dismissed sheet hands focus back to its button; a pick puts it in the textbox (`95` §4).
watch(recallOpen, (open, was) => {
  if (open || !was || recallPicked) return;
  void nextTick(() =>
    root.value?.querySelector<HTMLElement>('[data-test="assistant-recall-open"]')?.focus(),
  );
});

watch(
  () => Object.keys(store.state.sessions).join("\n"),
  (keys) => forgetComposerUi(new Set(keys.split("\n"))),
);

onMounted(() => {
  refreshRecall();
  const shell = shellRoot();
  shell?.addEventListener("dragover", onDragOver);
  shell?.addEventListener("dragleave", onDragLeave);
  shell?.addEventListener("drop", onDrop);
  const field = el();
  field?.addEventListener("click", detectMention);
  field?.addEventListener("keyup", onCaretKey);
  const onSelection = () => {
    if (document.activeElement !== field) return;
    if (mentionAt.value !== null) detectMention();
    voice.noteCaret(field?.selectionStart ?? 0);
  };
  document.addEventListener("selectionchange", onSelection);
  const onCompositionStart = () => voice.setComposing(true, field?.selectionStart ?? 0);
  const onCompositionEnd = () => voice.setComposing(false, field?.selectionStart ?? 0);
  field?.addEventListener("compositionstart", onCompositionStart);
  field?.addEventListener("compositionend", onCompositionEnd);
  const press = () => (pointerDown = true);
  const release = () => (pointerDown = false);
  document.addEventListener("pointerdown", press, true);
  document.addEventListener("pointerup", release, true);
  document.addEventListener("pointercancel", release, true);
  offs.push(() => {
    field?.removeEventListener("click", detectMention);
    field?.removeEventListener("keyup", onCaretKey);
    document.removeEventListener("selectionchange", onSelection);
    field?.removeEventListener("compositionstart", onCompositionStart);
    field?.removeEventListener("compositionend", onCompositionEnd);
    document.removeEventListener("pointerdown", press, true);
    document.removeEventListener("pointerup", release, true);
    document.removeEventListener("pointercancel", release, true);
    shell?.removeEventListener("dragover", onDragOver);
    shell?.removeEventListener("dragleave", onDragLeave);
    shell?.removeEventListener("drop", onDrop);
  });
  offs.push(
    // Rung a2: Escape while dictating stops dictation only; the container stays open (`10` §6.3).
    registerEscapeRung("a2", (event) => {
      if (
        !voice.mine.value ||
        !(event.target instanceof Node) ||
        !root.value?.contains(event.target)
      )
        return false;
      voice.stop("escape");
      return true;
    }),
    registerAssistantFocusTarget("composer", () => {
      if (!props.visible || !el()) return false;
      focusInput("end");
      return true;
    }),
    // Rung c: Escape in Reply mode leaves it before anything closes.
    registerEscapeRung("c", (event) => {
      if (!replying.value || !(event.target instanceof Node) || !root.value?.contains(event.target))
        return false;
      leaveReply();
      return true;
    }),
    // Rung c: Escape in the prefill-choice banner is Cancel and returns to the composer (`10` §6.3).
    registerEscapeRung("c", (event) => {
      if (
        !prefillPending.value ||
        !(event.target instanceof Node) ||
        !root.value?.contains(event.target)
      )
        return false;
      resolvePrefill(null);
      return true;
    }),
  );
});

onBeforeUnmount(() => {
  offs.forEach((off) => off());
  if (clockTimer) clearInterval(clockTimer);
  if (clearedTimer) clearTimeout(clearedTimer);
  if (mentionTimer) clearTimeout(mentionTimer);
  if (capTimer) clearTimeout(capTimer);
  if (busyTimer) clearInterval(busyTimer);
  cancelDeferredClose?.();
});

defineExpose({
  focusInput,
  prefill,
  closeOverlays: () => closeMention(),
});
</script>
