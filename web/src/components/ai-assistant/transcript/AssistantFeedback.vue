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
    v-if="visible"
    class="flex min-w-0 flex-col gap-1"
    role="group"
    :aria-label="t('assistant.feedback.groupName')"
    data-test="assistant-feedback"
  >
    <div class="flex items-center gap-1">
      <AssistantIconButton
        :label="t('assistant.feedback.helpful')"
        :icon="assistantGlyph.helpful"
        :pressed="vote === 'up'"
        data-test="assistant-feedback-up"
        @click="sendVote('up')"
      />
      <span v-if="isMobile" :ref="bindSheetTrigger" class="contents">
        <AssistantIconButton
          :label="t('assistant.feedback.notHelpful')"
          :icon="assistantGlyph.notHelpful"
          :pressed="vote === 'down'"
          aria-haspopup="dialog"
          :aria-expanded="reasonOpen"
          data-test="assistant-feedback-down"
        />
      </span>
      <component :is="isMobile ? OSheet : OPopover" v-model:open="reasonOpen" v-bind="wrapperProps">
        <template v-if="!isMobile" #trigger>
          <OButton
            variant="ghost"
            size="icon-sm"
            :aria-label="t('assistant.feedback.notHelpful')"
            :aria-pressed="vote === 'down'"
            :class="TOUCH_TARGET_CLASS"
            data-test="assistant-feedback-down"
          >
            <OIcon :name="assistantGlyph.notHelpful" size="sm" />
            <!-- The tooltip would sit over the dialog its button opened -->
            <OTooltip :content="t('assistant.feedback.notHelpful')" :disabled="reasonOpen" />
          </OButton>
        </template>
        <div
          ref="panel"
          class="flex min-w-0 flex-col gap-3 p-3"
          data-test="assistant-feedback-reason"
        >
          <OText variant="body-strong" as="h3">
            {{ t("assistant.feedback.whatWentWrong") }}
          </OText>
          <OToggleGroup
            v-model="reason"
            type="single"
            class="flex-wrap max-md:flex-col max-md:items-stretch"
          >
            <OToggleGroupItem
              v-for="slug in REASONS"
              :key="slug"
              :value="slug"
              size="sm"
              class="max-md:min-h-11 pointer-coarse:min-h-11"
              :data-test="`assistant-feedback-reason-${slug}`"
            >
              {{ t(`assistant.feedback.reason.${slug}`) }}
            </OToggleGroupItem>
          </OToggleGroup>
          <OTextarea
            v-model="detail"
            :label="t('assistant.feedback.addDetail')"
            :rows="2"
            width="full"
            data-test="assistant-feedback-detail"
          />
          <OText
            variant="meta"
            as="p"
            class="break-words"
            data-test="assistant-feedback-disclosure"
          >
            {{ t("assistant.feedback.disclosure") }}
          </OText>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <OButton
              variant="ghost"
              size="xs"
              :class="TOUCH_TARGET_CLASS"
              data-test="assistant-copy-chat-id"
              @click="copyChatId"
            >
              {{ t("assistant.feedback.copyChatId") }}
              <span class="text-text-secondary font-mono">{{ shortId }}</span>
              <OTooltip :content="fullId" />
            </OButton>
            <div class="flex gap-2 max-md:w-full">
              <OButton
                variant="outline"
                size="sm"
                :class="['max-md:flex-1', TOUCH_TARGET_CLASS]"
                data-test="assistant-feedback-cancel"
                @click="closeReason"
              >
                {{ t("assistant.feedback.cancel") }}
              </OButton>
              <OButton
                variant="primary"
                size="sm"
                :loading="sending"
                :class="['max-md:flex-1', TOUCH_TARGET_CLASS]"
                data-test="assistant-feedback-send"
                @click="sendReason"
              >
                {{ t("assistant.feedback.send") }}
              </OButton>
            </div>
          </div>
          <OText v-if="localOnly" variant="meta" as="p" data-test="assistant-feedback-local-only">
            {{ t("assistant.feedback.localOnlyId") }}
          </OText>
        </div>
      </component>
    </div>
    <OText v-if="thanks" variant="meta" as="p" data-test="assistant-feedback-thanks">
      {{ t("assistant.feedback.thanks") }}
    </OText>
    <div
      v-else-if="failedVote"
      class="flex flex-wrap items-center gap-2"
      data-test="assistant-feedback-failed"
    >
      <OText variant="meta">{{ t("assistant.feedback.failed") }}</OText>
      <OButton
        variant="ghost-primary"
        size="xs"
        :class="TOUCH_TARGET_CLASS"
        data-test="assistant-feedback-retry"
        @click="retry"
      >
        {{ t("assistant.feedback.retry") }}
      </OButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import {
  assistantEvidenceHostKey,
  footerOf,
  turnAnnotationKey,
  type AssistantTurnView,
} from "@/composables/assistant/pure";
import useBreakpoint from "@/composables/useBreakpoint";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OSheet from "@/lib/overlay/Sheet/OSheet.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { ChatMessage } from "@/ts/interfaces/chat";
import { raw, useI18nTyped } from "@/types/i18n";

const REASONS = ["wrong_data", "wrong_query", "too_slow", "wrong_action", "other"] as const;

const THANKS_MS = 3_000;

const SHORT_ID_CHARS = 8;

const props = withDefaults(
  defineProps<{
    message: ChatMessage;
    turn?: AssistantTurnView | null;
    readonly?: boolean;
  }>(),
  { turn: null, readonly: false },
);

const { t } = useI18nTyped();
const evidence = props.readonly ? null : inject(assistantEvidenceHostKey, null);
const { isMobile } = useBreakpoint();

const reasonOpen = ref(false);
const reason = ref<(typeof REASONS)[number] | undefined>(undefined);
const detail = ref("");
const sending = ref(false);
const thanks = ref(false);
const failedVote = ref<{ vote: "up" | "down"; reason?: string; comment?: string } | null>(null);
const panel = ref<HTMLElement | null>(null);
const sheetTrigger = ref<HTMLElement | null>(null);
let thanksTimer: ReturnType<typeof setTimeout> | null = null;

const sid = computed(() => props.turn?.sid ?? null);
// Only a finished answer of the reader's own chat takes a vote.
const visible = computed(
  () =>
    !props.readonly &&
    !!evidence &&
    !!sid.value &&
    (props.turn?.outcome === "done" || props.turn?.outcome === "done_not_saved") &&
    !!footerOf(props.message),
);
const vote = computed(() => {
  if (failedVote.value) return null;
  const session = sid.value && evidence ? evidence.session(sid.value) : null;
  const key = turnAnnotationKey(props.turn?.turnId ?? "", "feedback");
  return session?.annotations[key]?.feedback?.rating ?? null;
});
const fullId = computed(() => raw(sid.value ?? ""));
const shortId = computed(() => raw((sid.value ?? "").slice(0, SHORT_ID_CHARS)));
const localOnly = computed(() => evidence?.capability().persistence === false);

// The sheet and the popover take different props; the one rendered gets its own set.
const wrapperProps = computed<Record<string, unknown>>(() =>
  isMobile.value
    ? {
        snap: "full",
        snapPoints: ["half", "full"],
        ariaLabel: t("assistant.feedback.whatWentWrong"),
        expandLabel: t("assistant.shell.sheetExpand"),
        collapseLabel: t("assistant.shell.sheetPeek"),
        dataTest: "assistant-feedback-sheet",
        privacy: "mask",
      }
    : {
        side: "bottom",
        align: "start",
        ariaLabel: t("assistant.feedback.whatWentWrong"),
        contentClass: "w-[min(24rem,calc(100vw-1.5rem))]",
        privacy: "mask",
      },
);

async function send(next: {
  vote: "up" | "down";
  reason?: string;
  comment?: string;
}): Promise<boolean> {
  // One vote in flight per turn; a click meanwhile is ignored.
  if (!sid.value || !evidence || !props.turn || sending.value) return false;
  sending.value = true;
  failedVote.value = null;
  const result = await evidence.dispatch(sid.value, {
    kind: "feedback",
    messageId: props.turn.turnId,
    vote: next.vote,
    ...(next.reason && { reason: next.reason }),
    ...(next.comment && { comment: next.comment }),
  });
  sending.value = false;
  evidence.announce(
    sid.value,
    result.ok ? t("assistant.feedback.thanks") : t("assistant.feedback.failed"),
  );
  if (!result.ok) {
    failedVote.value = next;
    return false;
  }
  showThanks();
  return true;
}

function sendVote(next: "up" | "down"): void {
  if (vote.value === next) return;
  void send({ vote: next });
}

async function sendReason(): Promise<void> {
  const sentOk = await send({
    vote: "down",
    ...(reason.value && { reason: reason.value }),
    ...(detail.value.trim() && { comment: detail.value.trim() }),
  });
  if (sentOk) closeReason();
}

function retry(): void {
  if (failedVote.value) void send(failedVote.value);
}

function closeReason(): void {
  reasonOpen.value = false;
}

function showThanks(): void {
  thanks.value = true;
  if (thanksTimer) clearTimeout(thanksTimer);
  thanksTimer = setTimeout(() => (thanks.value = false), THANKS_MS);
}

async function copyChatId(): Promise<void> {
  if (!sid.value || !evidence) return;
  const result = await evidence.dispatch(sid.value, {
    kind: "copy",
    text: sid.value,
    what: "chat_id",
  });
  evidence.announce(
    sid.value,
    result.ok ? t("assistant.feedback.chatIdCopied") : t("assistant.client.copyManually"),
  );
}

// Escape closes the reason dialog before any outer Escape handler sees it.
function onPanelKeydown(event: KeyboardEvent): void {
  if (event.isComposing || event.key !== "Escape") return;
  event.preventDefault();
  event.stopPropagation();
  closeReason();
}

function showSheet(): void {
  reasonOpen.value = true;
}

function bindSheetTrigger(el: unknown): void {
  const next = el instanceof HTMLElement ? el : null;
  if (next === sheetTrigger.value) return;
  sheetTrigger.value?.removeEventListener("click", showSheet);
  next?.addEventListener("click", showSheet);
  sheetTrigger.value = next;
}

watch(panel, (el, _old, onCleanup) => {
  if (!el) return;
  el.addEventListener("keydown", onPanelKeydown);
  onCleanup(() => el.removeEventListener("keydown", onPanelKeydown));
});

watch(reasonOpen, async (open) => {
  if (!open) {
    reason.value = undefined;
    detail.value = "";
    if (isMobile.value) sheetTrigger.value?.querySelector<HTMLElement>("button")?.focus();
    return;
  }
  await nextTick();
  // A scrolling focus would close the popover, which closes on any ancestor scroll.
  panel.value
    ?.querySelector<HTMLElement>('[data-test^="assistant-feedback-reason-"]')
    ?.focus({ preventScroll: true });
});

onBeforeUnmount(() => {
  if (thanksTimer) clearTimeout(thanksTimer);
  sheetTrigger.value?.removeEventListener("click", showSheet);
});
</script>
