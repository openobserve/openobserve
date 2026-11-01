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
    v-if="confidenceLabel || stale"
    class="text-text-secondary flex min-w-0 flex-wrap items-center gap-x-1 text-xs leading-5"
    data-test="assistant-answer-meta"
  >
    <span v-if="confidenceLabel" data-test="assistant-answer-confidence">
      {{ confidenceLabel }}
    </span>
    <span v-if="stale" class="inline-flex items-center gap-x-1 whitespace-nowrap">
      <span v-if="confidenceLabel" aria-hidden="true">·</span>
      <span class="text-status-warning-text" data-test="assistant-answer-age">{{ ageLine }}</span>
      <template v-if="rerunShown">
        <span aria-hidden="true">·</span>
        <OButton
          variant="ghost-primary"
          size="chip"
          :disabled="!!blocked"
          :focusable-unavailable="!!blocked"
          :aria-label="rerunName"
          :class="TOUCH_TARGET_CLASS"
          data-test="assistant-rerun"
          @click="rerun"
        >
          {{ t("assistant.turn.rerun") }}
          <template v-if="blocked" #unavailable-reason>{{ blocked }}</template>
          <OTooltip v-if="blocked" :content="blocked" />
        </OButton>
      </template>
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from "vue";

import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import {
  assistantEvidenceHostKey,
  isStaleAnswer,
  isTerminal,
  promptRange,
  stepsOf,
  turnLockKey,
  useTurnLock,
  type AssistantTurnView,
} from "@/composables/assistant/pure";
import OButton from "@/lib/core/Button/OButton.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import type { ChatMessage } from "@/ts/interfaces/chat";
import { useI18nTyped, type I18nText } from "@/types/i18n";

import { dataAgeText, rangeText } from "./evidenceText";

const props = withDefaults(
  defineProps<{
    message: ChatMessage;
    turn?: AssistantTurnView | null;
    readonly?: boolean;
    /** Findings only: "Medium confidence", or "Inconclusive". */
    confidence?: "high" | "medium" | "low" | "inconclusive" | null;
  }>(),
  { turn: null, readonly: false, confidence: null },
);

const { t } = useI18nTyped();
const evidence = props.readonly ? null : inject(assistantEvidenceHostKey, null);

const steps = computed(() => stepsOf(props.message, props.turn?.org ?? ""));
const stale = computed(() => isStaleAnswer(steps.value, Date.now()));
const ageLine = computed(() => dataAgeText(steps.value, Date.now(), t));
const confidenceLabel = computed<I18nText | null>(() => {
  if (!props.confidence) return null;
  return t(`assistant.turn.confidence.${props.confidence}`);
});

// A re-run starts a turn, so the cross-tab lock holds it like every other turn start.
const lock = useTurnLock(() => props.turn?.sid ?? null);
const blocked = computed<I18nText | null>(() => {
  if (lock.value) return t(turnLockKey(lock.value));
  return evidence?.capability().creditMode === "exhausted"
    ? t("assistant.message.creditsUsedUp")
    : null;
});
// A send while another turn runs would join that turn, so Re-run waits for it.
const idle = computed(() => {
  const turn = props.turn?.sid && evidence ? evidence.session(props.turn.sid)?.turn : null;
  return !turn || turn.state === "idle" || isTerminal(turn);
});
const rerunShown = computed(
  () =>
    !props.readonly &&
    !!evidence &&
    !!props.turn?.sid &&
    !!props.turn.prompt &&
    props.turn.isLast &&
    idle.value,
);
const rerunName = computed(() => {
  const window = promptRange(props.turn?.prompt, props.turn?.askedWindow);
  return window
    ? t("assistant.footer.rerunFor", { range: rangeText(window) })
    : t("assistant.turn.rerun");
});

function rerun(): void {
  const sid = props.turn?.sid;
  if (!sid || !evidence || blocked.value || !props.turn) return;
  void evidence.dispatch(sid, { kind: "rerun_now", turnId: props.turn.turnId });
}
</script>
