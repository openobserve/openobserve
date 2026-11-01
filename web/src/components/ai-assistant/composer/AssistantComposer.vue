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
    class="flex shrink-0 flex-col gap-1.5 px-3 pt-1.5 pb-2"
  >
    <OBanner
      v-if="prefillPending"
      variant="info"
      dense
      inline-actions
      :content="t('assistant.welcome.prefill.question')"
      data-test="assistant-prefill-choice"
    >
      <template #actions>
        <OButton
          variant="outline"
          size="sm"
          class="max-md:min-h-11 pointer-coarse:min-h-11"
          data-test="assistant-prefill-choice-replace"
          @click="resolvePrefill('replace')"
        >
          {{ t("assistant.welcome.prefill.replace") }}
        </OButton>
        <OButton
          variant="outline"
          size="sm"
          class="max-md:min-h-11 pointer-coarse:min-h-11"
          data-test="assistant-prefill-choice-append"
          @click="resolvePrefill('append')"
        >
          {{ t("assistant.welcome.prefill.append") }}
        </OButton>
        <OButton
          variant="ghost"
          size="sm"
          class="max-md:min-h-11 pointer-coarse:min-h-11"
          data-test="assistant-prefill-choice-cancel"
          @click="resolvePrefill(null)"
        >
          {{ t("assistant.welcome.prefill.cancel") }}
        </OButton>
      </template>
    </OBanner>

    <!-- Keyed by notice: OBanner reads its actions slot once, so a notice that gains an action needs a fresh banner -->
    <OBanner
      v-if="clearedText"
      :key="cleared?.at"
      variant="default"
      dense
      inline-actions
      :content="clearedText"
      data-test="assistant-composer-cleared"
    >
      <template v-if="cleared?.token || cleared?.from" #actions>
        <OButton
          variant="outline"
          size="sm"
          class="max-md:min-h-11 pointer-coarse:min-h-11"
          data-test="assistant-composer-undo"
          @click="undoClear"
        >
          {{ cleared?.from ? t("assistant.composer.bringDraft") : t("assistant.composer.undo") }}
        </OButton>
      </template>
    </OBanner>

    <div class="relative flex flex-col gap-1.5">
      <AssistantMentionMenu
        ref="mention"
        :open="mentionAt !== null"
        :query="mentionQuery"
        :org="org"
        :listbox-id="listboxId"
        @select="pickMention"
        @close="closeMention"
      />
      <!-- One frame holds the chips, the text and its controls, so the message reads as one control (D4 §3.1) -->
      <OTextarea
        ref="textbox"
        :model-value="shownText"
        :rows="1"
        autogrow
        :max-rows="8"
        :size="density === 'roomy' ? 'md' : 'sm'"
        width="full"
        :readonly="inertKind !== null"
        :placeholder="placeholder"
        :input-attrs="textboxAttrs"
        placeholder-tone="strong"
        data-test="assistant-composer"
        :data-state="state"
        @update:model-value="onInput"
        @keydown="onKeydown"
        @paste="onPaste"
        @focus="refreshPageContext"
        @blur="onBlur"
      >
        <template v-if="$slots.chips || images.length > 0" #header>
          <div
            class="flex min-w-0 flex-col gap-1 px-1.5 pt-1.5"
            data-test="assistant-composer-chips"
          >
            <slot name="chips" />
            <ul
              v-if="images.length > 0"
              class="flex flex-wrap gap-1.5"
              data-test="assistant-image-strip"
            >
              <li v-for="image in images" :key="image.id ?? image.filename">
                <AssistantChipPopover
                  :chip="imageChip(image)"
                  :image-src="dataUrl(image)"
                  :open="openImage === image.id"
                  @update:open="(open) => (openImage = open ? (image.id ?? null) : null)"
                  @remove="removeImage(image)"
                >
                  <template #anchor>
                    <span
                      class="border-border-default rounded-default inline-flex items-center gap-0.5 border p-0.5"
                    >
                      <OButton
                        variant="ghost"
                        size="icon-md"
                        class="p-0! max-md:size-11 pointer-coarse:size-11"
                        :aria-label="image.filename"
                        aria-haspopup="dialog"
                        :aria-expanded="openImage === image.id"
                        data-test="assistant-image-open"
                        @click="openImage = image.id ?? null"
                      >
                        <img
                          :src="dataUrl(image)"
                          :alt="image.filename"
                          class="rounded-default size-10 object-cover"
                        />
                      </OButton>
                      <OButton
                        variant="ghost"
                        size="icon-xs"
                        class="max-md:size-11 pointer-coarse:size-11"
                        :aria-label="t('assistant.composer.removeImage', { name: image.filename })"
                        data-test="assistant-image-remove"
                        @click="removeImage(image)"
                      >
                        <OIcon :name="assistantGlyph.close" size="xs" />
                      </OButton>
                    </span>
                  </template>
                </AssistantChipPopover>
              </li>
            </ul>
          </div>
        </template>
        <template #footer>
          <div
            class="flex items-center gap-1 px-1.5 pb-1.5"
            data-test="assistant-composer-controls"
          >
            <AssistantAddContextMenu
              v-if="!replying"
              ref="addMenu"
              :org="org"
              @select="addOption"
              @image="openPicker"
            />
            <AssistantIconButton
              v-if="!mdUp && recallEntries.length > 0"
              :label="t('assistant.composer.recentPrompts')"
              :icon="assistantGlyph.history"
              data-test="assistant-recall-open"
              @click="recallOpen = true"
            />
            <span class="flex-1" />
            <AssistantDictationMeter
              v-if="voice.listening.value"
              :label="voice.rowLabel.value"
              :level="voice.level.value"
              :elapsed-ms="voice.elapsedMs.value"
            />
            <AssistantDictateButton
              v-if="voice.show.value"
              :pressed="voice.mine.value"
              :denied="voice.denied.value"
              :primer-open="voice.primerOpen.value"
              :sentence="voice.sentence.value"
              :disabled-reason="micOffReason"
              @press="onMicPress"
              @accept="voice.acceptPrimer"
              @decline="voice.declinePrimer"
            />
            <span class="grid">
              <AssistantIconButton
                v-if="showStop"
                :variant="stalled ? 'secondary' : 'outline'"
                :label="t('assistant.turn.stopLabel')"
                :icon="assistantGlyph.stop"
                :loading="state === 'stopping'"
                class="hover:text-status-warning-text focus-visible:text-status-warning-text"
                data-test="assistant-stop"
                @click="stop"
              />
              <AssistantIconButton
                v-else
                variant="primary"
                :label="t('assistant.turn.sendLabel')"
                :icon="assistantGlyph.send"
                :disabled="!canSend"
                :disabled-reason="sendBlockedReason"
                data-test="assistant-send"
                @click="trySend"
              />
            </span>
          </div>
          <OText
            v-if="voice.waiting.value"
            variant="meta"
            as="p"
            class="px-3 pb-1.5"
            data-test="assistant-dictate-waiting"
          >
            {{ t("assistant.voice.waitingPermission") }}
          </OText>
        </template>
      </OTextarea>
      <AssistantDictationTail
        :field="textbox?.textarea ?? null"
        :before="text.slice(0, voice.anchor.value)"
        :tail="voice.tail.value"
      />
      <span :id="ghostHintId" class="sr-only">{{ ghostHint }}</span>
      <OButton
        v-if="ghostShown && ghost"
        variant="ghost-muted"
        size="sm"
        class="h-auto! justify-start! py-1 text-start whitespace-normal! max-md:min-h-11 pointer-coarse:min-h-11"
        data-test="assistant-ghost"
        @click="acceptGhost"
      >
        {{ t("assistant.welcome.try", { prompt: ghost.label }) }}
      </OButton>
    </div>

    <div v-if="helper" class="flex min-w-0 flex-wrap items-center gap-x-2">
      <OText
        :id="helperId"
        variant="meta"
        as="p"
        :class="['min-w-0 flex-1', helperEmphasis ? 'text-text-body font-medium' : '']"
        data-test="assistant-composer-helper"
      >
        {{ helper }}
      </OText>
      <OButton
        v-if="replying"
        variant="ghost"
        size="xs"
        :class="TOUCH_TARGET_CLASS"
        data-test="assistant-composer-reply-cancel"
        @click="leaveReply"
      >
        {{ t("assistant.composer.replyCancel") }}
      </OButton>
      <OButton
        v-if="pasteOffer && helper === pasteLine"
        variant="ghost-primary"
        size="xs"
        :class="TOUCH_TARGET_CLASS"
        data-test="assistant-composer-paste-inline"
        @click="pasteInline"
      >
        {{ t("assistant.context.pasteInline") }}
      </OButton>
      <OButton
        v-if="helper === voice.helperLine.value && voice.action.value === 'retry'"
        variant="ghost-primary"
        size="xs"
        :class="TOUCH_TARGET_CLASS"
        data-test="assistant-dictate-retry"
        @click="voice.retry"
      >
        {{ t("assistant.voice.tryAgain") }}
      </OButton>
      <AssistantVoiceAllowPopover
        v-if="helper === voice.helperLine.value && voice.action.value === 'how'"
        :steps="voice.allowSteps.value"
      />
    </div>
    <OText
      v-if="storageBlocked"
      variant="meta"
      as="p"
      data-test="assistant-composer-storage-blocked"
    >
      {{ t("assistant.client.storageBlocked") }}
    </OText>
    <span role="status" aria-live="polite" class="sr-only" data-test="assistant-composer-status">
      <span v-if="status" :key="status.seq">{{ status.text }}</span>
    </span>

    <OFile
      ref="file"
      class="hidden"
      accept="image/png,image/jpeg"
      multiple
      :model-value="null"
      :max-file-size="MAX_IMAGE_SIZE_BYTES"
      @change="onPicked"
      @size-error="(files) => files.forEach(refuseSize)"
      @type-error="() => refuse('type', t('assistant.context.imageType'))"
    />
    <AssistantRecallSheet
      v-if="!mdUp"
      v-model:open="recallOpen"
      :entries="recallEntries"
      @select="pickRecall"
    />
  </div>
</template>

<script lang="ts">
import type { AssistantHostAdapter, ContextChip, Sid, TurnTerminal } from "@/composables/assistant";
import type { StarterKind } from "@/services/assistantAnalytics";
import type { I18nText } from "@/types/i18n";

/** The welcome's first starter, which the empty composer offers inline (`70` §5). */
export interface ComposerGhost {
  label: I18nText;
  text: string;
  chips: ContextChip[];
  kind?: StarterKind;
  /** A Home starter, whose question may get the wider-window offer (PO A26). */
  home?: boolean;
}

export interface AssistantComposerProps {
  sid: Sid | null;
  density?: "compact" | "roomy";
  ghost?: ComposerGhost | null;
  host?: AssistantHostAdapter;
  /** Only the composer the user sees announces, restores and takes focus requests. */
  visible?: boolean;
  /** Send waits while the host counts a `retry_after` down; the reason says why. */
  cooldownReason?: I18nText;
}

/** A starter prompt over a draft this long asks Replace · Append · Cancel (IW-06 AC 5). */
export const PREFILL_CHOICE_CHARS = 500;

// Long enough to read, short enough not to linger after the next key.
const EMPHASIS_MS = 2_000;

// Long enough that typing a query speaks once, not per key.
const MENTION_ANNOUNCE_MS = 400;

const CARET_KEYS: ReadonlySet<string> = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import AssistantChipPopover from "@/components/ai-assistant/context/AssistantChipPopover.vue";
import AssistantMentionMenu, {
  type MentionOption,
} from "@/components/ai-assistant/context/AssistantMentionMenu.vue";
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
  periodMs,
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
import useBreakpoint from "@/composables/useBreakpoint";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OBanner from "@/lib/feedback/Banner/OBanner.vue";
import OFile from "@/lib/forms/File/OFile.vue";
import type { FileValue } from "@/lib/forms/File/OFile.types";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import { MAX_IMAGE_SIZE_BYTES, type ImageAttachment } from "@/ts/interfaces/chat";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatBytes } from "@/utils/formatters";
import { getUUIDv7 } from "@/utils/uuid";

import AssistantAddContextMenu from "./AssistantAddContextMenu.vue";
import AssistantDictateButton from "./AssistantDictateButton.vue";
import AssistantDictationMeter from "./AssistantDictationMeter.vue";
import AssistantDictationTail from "./AssistantDictationTail.vue";
import AssistantRecallSheet from "./AssistantRecallSheet.vue";
import AssistantVoiceAllowPopover from "./AssistantVoiceAllowPopover.vue";
import {
  announceComposer,
  composerUi,
  moveDraft,
  forgetComposerUi,
  noteCap,
  noteDraftCleared,
} from "./composerUi";
import { useAssistantVoice } from "./useAssistantVoice";

const props = withDefaults(defineProps<AssistantComposerProps>(), {
  density: "compact",
  ghost: null,
  host: undefined,
  visible: true,
  cooldownReason: undefined,
});

const { t } = useI18nTyped();
const store = useAssistantStore();
const placement = useAssistantPlacement(store);
const { mdUp } = useBreakpoint();
const root = ref<HTMLElement | null>(null);
const textbox = ref<InstanceType<typeof OTextarea> | null>(null);
const file = ref<InstanceType<typeof OFile> | null>(null);
const addMenu = ref<InstanceType<typeof AssistantAddContextMenu> | null>(null);
const mention = ref<InstanceType<typeof AssistantMentionMenu> | null>(null);
const uid = useId();
const helperId = `assistant-composer-helper-${uid}`;
const ghostHintId = `assistant-composer-ghost-${uid}`;
const listboxId = `assistant-mention-${uid}`;

// View state only; every draft write is a store action.
const helperEmphasis = ref(false);
const blockedLine = ref<I18nText | null>(null);
const droppedImages = ref(0);
const recallOpen = ref(false);
const recallEntries = ref<RecallEntry[]>([]);
const openImage = ref<string | null>(null);
const mentionAt = ref<number | null>(null);
const mentionQuery = ref("");
const prefillPending = ref<{ text: string; chips: ContextChip[]; homeStarter?: boolean } | null>(
  null,
);
// The last long paste, offered back as plain text until the next edit or send (D4 decision 10).
const pasteOffer = ref<{ chipId: string; text: string; at: number } | null>(null);
const now = ref(Date.now());
let emphasisTimer: ReturnType<typeof setTimeout> | null = null;
let emptyEnterSaid = false;
let recallPicked = false;
let mentionTimer: ReturnType<typeof setTimeout> | null = null;
let pointerDown = false;
let cancelDeferredClose: (() => void) | null = null;
let clearedTimer: ReturnType<typeof setTimeout> | null = null;
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
const hasContent = computed(
  () => !!text.value.trim() || stagedChips.value.length > 0 || images.value.length > 0,
);
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
// Reply is the one way to type under an approval card; its Enter answers the card.
const inertKind = computed<"approval" | "consent" | null>(() => {
  if (session.value?.pendingApproval && !replying.value) return "approval";
  return session.value?.pendingConsent ? "consent" : null;
});

const voice = useAssistantVoice({
  field: el,
  ensureSid,
  draftOf: (id) => store.state.sessions[id]?.composer.text ?? null,
  writeDraft(id, value) {
    freshSendId(id);
    emptyEnterSaid = false;
    store.setDraft(id, { text: value });
  },
  blocked: () => !props.visible || !!inertKind.value,
  touch: () => !mdUp.value && !!window.matchMedia?.("(pointer: coarse)").matches,
  say,
  focusField: () => el()?.focus({ preventScroll: true }),
});

// The textbox shows the unsettled tail; the draft never holds it.
const shownText = computed(() => voice.shown(text.value));

const state = computed(() => {
  if (inertKind.value) return "inert";
  if (replying.value) return "reply";
  if (turn.value?.state === "stopping") return "stopping";
  if (voice.mine.value) return "listening";
  if (elsewhere.value) return "elsewhere";
  if (running.value) return "running";
  return hasContent.value ? "draft" : "empty";
});

const showStop = computed(() => running.value);

// After 30 s without a frame Stop is the one emphasised control (HT-01 AC 3); the clock runs only while a turn does.
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
const canSend = computed(
  () =>
    voice.mine.value ||
    (hasContent.value &&
      !inertKind.value &&
      (replying.value || (!running.value && !props.cooldownReason))),
);
const sendBlockedReason = computed(() => {
  if (props.cooldownReason) return props.cooldownReason;
  if (inertKind.value)
    return inertKind.value === "approval"
      ? t("assistant.composer.waitingApproval")
      : t("assistant.composer.waitingConsent");
  return hasContent.value ? undefined : t("assistant.composer.sendEmpty");
});

const micOffReason = computed<I18nText | undefined>(() => {
  if (voice.status.value === "silent") return t("assistant.voice.error.browser_silent");
  if (voice.offline.value && !voice.mine.value) return t("assistant.composer.offline");
  if (inertKind.value === "approval") return t("assistant.composer.waitingApproval");
  return inertKind.value === "consent" ? t("assistant.composer.waitingConsent") : undefined;
});

// A chat with no messages shows the welcome, and the ghost never repeats its starters (D5 decision 11, PO A34).
const ghostShown = computed(
  () =>
    !!props.ghost &&
    !!session.value?.messages.length &&
    !hasContent.value &&
    (composer.value?.recallIndex ?? -1) === -1,
);
const ghostHint = computed(() =>
  ghostShown.value && props.ghost
    ? t("assistant.welcome.ghostHint", { label: props.ghost.label })
    : raw(""),
);

const placeholder = computed<I18nText>(() => {
  if (replying.value) return t("assistant.composer.replyPlaceholder");
  if (props.ghost) return t("assistant.composer.name", { product: t("assistant.name") });
  if (context.noScope.value) return t("assistant.composer.placeholderEmpty");
  return t("assistant.composer.placeholder", { summary: context.summary.value });
});

const recallHint = computed(() => {
  const key = store.state.userOrgKey;
  if (!key || hasContent.value || recallEntries.value.length === 0 || readHints(key).recall)
    return null;
  const count = recallEntries.value.length;
  return t("assistant.composer.recallHint", { count }, count);
});

const creditsRefusedAbove = computed(() => {
  const turn = session.value?.turn;
  return turn?.state === "refused" && isCreditsRefusal(turn.error.code);
});

const helper = computed<I18nText | null>(() => {
  if (inertKind.value === "approval") return t("assistant.composer.waitingApproval");
  if (inertKind.value === "consent") return t("assistant.composer.waitingConsent");
  if (voice.helperLine.value) return voice.helperLine.value;
  if (replying.value) return t("assistant.composer.replyHelper");
  if (blockedLine.value) return blockedLine.value;
  const notice = liveSid.value ? store.entryNotice(liveSid.value) : null;
  if (notice) return t(notice);
  if (pasteOffer.value) return pasteLine.value;
  if (droppedImages.value > 0)
    return t(
      "assistant.composer.imagesDropped",
      { count: droppedImages.value },
      droppedImages.value,
    );
  // Send stays enabled: the server is the gate, the line only predicts a refusal not yet shown above.
  if (store.state.capability.creditMode === "exhausted" && !creditsRefusedAbove.value)
    return t("assistant.credits.predictedExhausted", { org: raw(org.value) });
  if (voice.show.value && voice.offline.value) return t("assistant.composer.offline");
  return recallHint.value;
});

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

const textboxAttrs = computed(() => ({
  "aria-label": t("assistant.composer.name", { product: t("assistant.name") }),
  "aria-multiline": "true",
  "aria-placeholder": placeholder.value,
  "aria-describedby":
    [helper.value ? helperId : null, ghostShown.value ? ghostHintId : null]
      .filter(Boolean)
      .join(" ") || undefined,
  "aria-disabled": inertKind.value ? "true" : undefined,
  // A textarea cannot be a combobox, so there is no `aria-expanded`; the menu's state is spoken instead.
  "aria-autocomplete": "list",
  "aria-controls": mentionAt.value !== null ? listboxId : undefined,
  "aria-activedescendant": mentionAt.value !== null ? mention.value?.activeId : undefined,
  "data-assistant-composer": "",
  class: "max-md:min-h-11 pointer-coarse:min-h-11",
}));

/** Puts the caret at the end or at an offset (CT-08 AC 9; `70` landing rules). */
function focusInput(caret: "end" | number = "end"): void {
  const target = el();
  if (!target) return;
  target.focus({ preventScroll: true });
  const at = caret === "end" ? target.value.length : Math.min(caret, target.value.length);
  target.setSelectionRange(at, at);
}

function say(line: I18nText): void {
  if (props.visible && liveSid.value) announceComposer(liveSid.value, line);
}

function clearBlocked(): void {
  blockedLine.value = null;
  helperEmphasis.value = false;
}

function emphasise(line: I18nText): void {
  blockedLine.value = line;
  helperEmphasis.value = true;
  if (emphasisTimer) clearTimeout(emphasisTimer);
  emphasisTimer = setTimeout(() => (helperEmphasis.value = false), EMPHASIS_MS);
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

/** A pick from the `+` menu: the same chip or time as `@`, with the text left as typed. */
function addOption(option: MentionOption): void {
  const id = liveSid.value ?? ensureSid();
  if (!id) return;
  const mixed = mixedStreamType(option);
  if (mixed) return capHit("type", t("assistant.context.mixedStreams", { type: raw(mixed) }));
  applyOption(id, option);
  void nextTick(() => focusInput("end"));
}

// Adds the option's chip or sets its time; false when a cap refused the chip.
function applyOption(id: Sid, option: MentionOption): boolean {
  if (option.kind !== "time" && option.chip) {
    const result = store.addChip(id, option.chip);
    if (!result.ok) {
      capHit(result.cap === "rows" ? "rows" : "bytes");
      return false;
    }
  }
  if (option.kind === "time") {
    const period = option.period ?? null;
    store.setTimeOverride(
      id,
      period ? { from: Date.now() - periodMs(period), to: Date.now(), period } : null,
    );
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
    return;
  }
  if ((event.key === "ArrowRight" || event.key === "End") && ghostShown.value && !target.value) {
    event.preventDefault();
    acceptGhost();
  }
}

function mentionKey(event: KeyboardEvent): boolean {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    mention.value?.move(event.key === "ArrowDown" ? 1 : -1);
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
    const line = helper.value ?? t("assistant.composer.waitingApproval");
    if (!helperEmphasis.value) say(line);
    return emphasise(line);
  }
  if (replying.value) {
    if (hasContent.value) return void sendReply(id);
    if (!emptyEnterSaid) say(t("assistant.composer.sendEmpty"));
    emptyEnterSaid = true;
    return;
  }
  if (props.cooldownReason) {
    if (blockedLine.value !== props.cooldownReason) say(props.cooldownReason);
    return emphasise(props.cooldownReason);
  }
  if (running.value) {
    trackAssistant("ai_composer_enter_blocked", {
      reason: elsewhere.value ? "elsewhere" : "running",
    });
    const line = t("assistant.composer.running");
    if (blockedLine.value !== line) say(line);
    return emphasise(line);
  }
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
  void nextTick(() => assistantFocusCard() || focusInput("end"));
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
  markHintSeen(key, "recall");
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

function acceptGhost(): void {
  const id = ensureSid();
  const ghost = props.ghost;
  if (!id || !ghost) return;
  store.stage(id, {
    text: ghost.text,
    chips: ghost.chips,
    mode: "replace",
    ...(ghost.home && { homeStarter: true }),
  });
  trackAssistant("ai_welcome_starter", {
    starter_kind: ghost.kind ?? "page",
    index: 0,
    via: "ghost",
  });
  say(t("assistant.welcome.ghostInserted"));
  void nextTick(() => focusInput("end"));
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
        ?.querySelector<HTMLElement>('[data-test="assistant-prefill-choice-append"]')
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
      capHit(result.cap === "images" ? "images" : result.cap);
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
  voice.press("mic");
  if (event.detail > 0 && !voice.primerOpen.value) el()?.focus({ preventScroll: true });
}

function removeImage(image: ImageAttachment): void {
  const id = liveSid.value;
  if (!id || !image.id) return;
  store.removeImage(id, image.id);
  openImage.value = null;
  say(t("assistant.context.removed", { label: raw(image.filename) }));
  trackAssistant("ai_context_changed", {
    action: "remove",
    kind: "image",
    count: 1,
    bytes: image.size,
  });
  void nextTick(() => focusInput("end"));
}

function imageChip(image: ImageAttachment): ContextChip {
  return {
    id: image.id ?? image.filename,
    kind: "image",
    label: raw(image.filename),
    secondary: raw(formatBytes(image.size)),
    sizeBytes: image.size,
    provenance: "attach",
    sent: "serialized",
  };
}

function dataUrl(image: ImageAttachment): string {
  return `data:${image.mimeType};base64,${image.data}`;
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

// A reason for a swallowed Enter is true only while its cause lasts (U8).
watch(inertKind, (kind) => {
  if (kind === null) clearBlocked();
  else voice.stop("other");
});

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
      // A spent notice is dropped, so other notices (the disclosure) may show again.
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

watch(recallHint, (hint) => {
  const key = store.state.userOrgKey;
  if (hint && key && props.visible) markHintSeen(key, "recall");
});

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
  if (emphasisTimer) clearTimeout(emphasisTimer);
  if (clearedTimer) clearTimeout(clearedTimer);
  if (mentionTimer) clearTimeout(mentionTimer);
  cancelDeferredClose?.();
});

defineExpose({
  focusInput,
  prefill,
  closeOverlays: () => (closeMention(), addMenu.value?.close()),
});
</script>
