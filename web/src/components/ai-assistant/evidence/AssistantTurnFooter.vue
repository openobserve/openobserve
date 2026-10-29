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
  <div v-if="visible" ref="root" class="flex min-w-0 flex-col gap-1">
    <div
      v-if="hasLine"
      class="text-text-secondary flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1 text-xs leading-5"
      data-test="assistant-turn-footer"
      :data-variant="variant"
    >
      <template v-if="windows.length">
        <span v-if="windows.length === 1" data-test="assistant-turn-footer-evaluated">
          {{ evaluatedHead }}
        </span>
        <OPopover
          v-if="windows.length > 1"
          side="top"
          align="start"
          :aria-label="t('assistant.footer.windowsName')"
          content-class="flex w-[min(20rem,calc(100vw-1.5rem))] flex-col gap-1 p-2"
        >
          <template #trigger>
            <OButton
              variant="ghost-primary"
              size="xs"
              :class="TOUCH_TARGET_CLASS"
              data-test="assistant-turn-footer-windows"
            >
              {{ evaluatedHead }}
            </OButton>
          </template>
          <OButton
            v-for="window in windows"
            :key="window.step.callId"
            variant="ghost"
            size="sm"
            :class="['justify-start', TOUCH_TARGET_CLASS]"
            :data-test="`assistant-turn-footer-window-${window.step.n}`"
            @click="openWindow(window.step.callId)"
          >
            {{ t("assistant.footer.windowStep", { n: window.step.n, range: rangeText(window) }) }}
          </OButton>
        </OPopover>
        <span aria-hidden="true">·</span>
        <span>{{ t("assistant.footer.queries", { count: queries }, queries) }}</span>
      </template>
      <span v-else-if="!stopped" data-test="assistant-turn-footer-no-query">{{
        t("assistant.footer.noQuery")
      }}</span>
      <template v-if="credits">
        <span v-if="windows.length || !stopped" aria-hidden="true">·</span>
        <OPopover
          v-if="tokensLine"
          side="top"
          align="start"
          :aria-label="credits"
          content-class="p-2 text-xs"
        >
          <template #trigger>
            <OButton
              variant="ghost"
              size="xs"
              :class="TOUCH_TARGET_CLASS"
              data-test="assistant-turn-footer-credits"
            >
              {{ credits }}
            </OButton>
          </template>
          <OText variant="meta" as="p" data-test="assistant-turn-footer-tokens">{{
            tokensLine
          }}</OText>
        </OPopover>
        <OPopover v-else side="top" align="start" :aria-label="credits" content-class="p-2 text-xs">
          <template #trigger>
            <OButton
              variant="ghost"
              size="xs"
              :class="TOUCH_TARGET_CLASS"
              data-test="assistant-turn-footer-credits"
            >
              {{ credits }}
            </OButton>
          </template>
          <OText variant="meta" as="p">{{ t("assistant.footer.creditsCountedHint") }}</OText>
        </OPopover>
      </template>
      <template v-if="stopped">
        <span aria-hidden="true">·</span>
        <span data-test="assistant-turn-footer-stopped">{{ t("assistant.footer.stopped") }}</span>
      </template>
      <template v-if="notSaved">
        <span aria-hidden="true">·</span>
        <OPopover
          side="top"
          align="start"
          :aria-label="t('assistant.footer.notSaved')"
          content-class="p-2 text-xs"
        >
          <template #trigger>
            <OButton
              variant="ghost"
              size="xs"
              :class="TOUCH_TARGET_CLASS"
              data-test="assistant-turn-footer-not-saved"
            >
              {{ t("assistant.footer.notSaved") }}
            </OButton>
          </template>
          <OText variant="meta" as="p">{{ t("assistant.footer.notSavedHint") }}</OText>
        </OPopover>
      </template>
      <OButton
        v-if="canRerun"
        :variant="isMobile ? 'secondary' : 'ghost'"
        size="sm"
        :disabled="!!rerunBlocked"
        :focusable-unavailable="!!rerunBlocked"
        :class="['max-md:w-full', TOUCH_TARGET_CLASS]"
        data-test="assistant-rerun"
        @click="rerun"
      >
        {{ t("assistant.footer.rerun") }}
        <template v-if="rerunBlocked" #unavailable-reason>{{ rerunBlocked }}</template>
        <OTooltip v-if="rerunBlocked" :content="rerunBlocked" />
      </OButton>
    </div>
    <div
      v-if="context"
      role="group"
      :aria-label="t('assistant.context.usedName')"
      class="flex min-w-0 flex-wrap items-center gap-1.5 text-xs"
      :data-kind="context.kind"
      data-test="assistant-turn-context-used"
    >
      <OText variant="meta">{{
        context.kind === "used" ? t("assistant.context.used") : t("assistant.context.sentLine")
      }}</OText>
      <OText v-if="!context.labels.length" variant="meta">{{
        t("assistant.context.usedNone")
      }}</OText>
      <OTag
        v-for="(label, index) in context.labels"
        :key="index"
        type="assistantContext"
        :value="context.kind === 'used' ? 'used' : 'sent'"
        :label="label"
        class="max-w-full"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from "vue";

import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import {
  assistantEvidenceHostKey,
  footerOf,
  isTerminal,
  queryCount,
  stepsOf,
  turnLockKey,
  useTurnLock,
  windowsOf,
  type AssistantTurnView,
} from "@/composables/assistant/pure";
import useBreakpoint from "@/composables/useBreakpoint";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { ChatMessage, ContentBlock } from "@/ts/interfaces/chat";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatCount } from "@/utils/formatters";

import { rangeText } from "./evidenceText";
import { revealStep } from "./revealStep";

const props = withDefaults(
  defineProps<{
    block?: ContentBlock;
    blockId?: string;
    message: ChatMessage;
    readonly?: boolean;
    density?: "compact" | "roomy";
    turn?: AssistantTurnView | null;
  }>(),
  { block: undefined, blockId: "", readonly: false, density: "compact", turn: null },
);

const { t } = useI18nTyped();
const evidence = props.readonly ? null : inject(assistantEvidenceHostKey, null);
const { isMobile } = useBreakpoint();
const root = ref<HTMLElement | null>(null);

const outcome = computed(() => props.turn?.outcome ?? "done");
// A refused or still-running turn evaluated nothing yet, so it has no footer.
const visible = computed(() => outcome.value !== "live" && (hasLine.value || !!context.value));
const steps = computed(() => stepsOf(props.message, props.turn?.org ?? ""));
const windows = computed(() => windowsOf(steps.value));
const queries = computed(() => queryCount(steps.value));
const footer = computed(() => footerOf(props.message));
const stopped = computed(() => outcome.value === "stopped" || outcome.value === "failed");
const notSaved = computed(
  () => outcome.value === "done_not_saved" || footer.value?.persisted === false,
);
// An ended turn says nothing beyond its outcome block, except what it evaluated and the credit it was charged.
const hasLine = computed(() => !stopped.value || windows.value.length > 0 || !!credits.value);
const capability = computed(() => evidence?.capability() ?? null);
const exhausted = computed(() => capability.value?.creditMode === "exhausted");
// A re-run starts a turn, so the cross-tab lock holds it like every other turn start.
const turnLock = useTurnLock(() => props.turn?.sid ?? null);
const rerunBlocked = computed<I18nText | null>(() => {
  if (turnLock.value) return t(turnLockKey(turnLock.value));
  return exhausted.value ? t("assistant.message.creditsUsedUp") : null;
});
const live = computed(() => !props.readonly && !!evidence && !!props.turn?.sid);
// A send while another turn runs would join that turn, so Re-run waits for it.
const sessionIdle = computed(() => {
  const turn = props.turn?.sid && evidence ? evidence.session(props.turn.sid)?.turn : null;
  return !turn || turn.state === "idle" || isTerminal(turn);
});
const canRerun = computed(
  () => live.value && sessionIdle.value && windows.value.length > 0 && !!props.turn?.prompt,
);
const variant = computed(() =>
  !windows.value.length
    ? "no_query"
    : stopped.value
      ? "stopped"
      : notSaved.value
        ? "not_saved"
        : "done",
);

// Several windows read as one sentence, which is the popover's trigger.
const evaluatedHead = computed<I18nText>(() => {
  const first = windows.value[0];
  if (!first) return raw("");
  const range = rangeText(first);
  const others = windows.value.length - 1;
  return others > 0
    ? t("assistant.footer.evaluatedMore", { range, count: others }, others)
    : t("assistant.footer.evaluated", { range });
});

// Cloud only, never on a shared page; the flat 1 until the server counts credits.
const credits = computed<I18nText | null>(() => {
  const mode = capability.value?.creditMode;
  if (!mode || props.readonly) return null;
  const count = footer.value?.usage?.credits ?? 1;
  // Only a server count of 0 on a failed or stopped turn is a refund; the flat rule never claims one.
  if (count === 0 && stopped.value) return t("assistant.footer.refunded");
  return mode === "free"
    ? t("assistant.footer.includedCredits", { count: formatCount(count) }, count)
    : t("assistant.footer.credits", { count: formatCount(count) }, count);
});

const tokensLine = computed<I18nText | null>(() => {
  const usage = footer.value?.usage;
  if (usage?.totalTokens === undefined) return null;
  const calls = usage.llmCalls ?? 0;
  return t(
    "assistant.footer.tokens",
    { tokens: formatCount(usage.totalTokens), count: formatCount(calls) },
    calls,
  );
});

const context = computed<{ kind: "used" | "sent"; labels: I18nText[] } | null>(() => {
  const used = footer.value?.contextUsed;
  const chips = props.turn?.prompt?.chips ?? [];
  if (used) {
    const labels = used.map(
      (key) => chips.find((chip) => chip.id === key || chip.ref?.type === key)?.label ?? raw(key),
    );
    return { kind: "used", labels };
  }
  if (!chips.length) return null;
  return { kind: "sent", labels: chips.map((chip) => chip.label) };
});

function rerun(): void {
  const sid = props.turn?.sid;
  if (!sid || !evidence || rerunBlocked.value || !props.turn) return;
  void evidence.dispatch(sid, { kind: "rerun_now", turnId: props.turn.turnId });
}

async function openWindow(callId: string): Promise<void> {
  const sid = props.turn?.sid;
  if (sid && evidence) await evidence.dispatch(sid, { kind: "open_step", callId });
  await revealStep(root.value, callId);
}
</script>
