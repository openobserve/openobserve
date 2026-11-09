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
  <form
    ref="root"
    data-test="rca-steer-composer"
    class="flex flex-none flex-col px-3 pt-1.5 pb-2"
    @submit.prevent="submit"
  >
    <AssistantComposerFrame
      v-model="draft"
      :state="waitingInput ? 'paused' : 'steer'"
      :placeholder="
        waitingInput
          ? t('alerts.incidents.rcaSteer.placeholderPaused')
          : t('assistant.composer.steerPlaceholder')
      "
      :disabled="sending"
      :input-attrs="{
        'aria-label': waitingInput
          ? t('alerts.incidents.rcaSteer.composerTitlePaused')
          : t('alerts.incidents.rcaSteer.composerTitleLive'),
        'aria-describedby': notice ? noticeId : undefined,
        maxlength: MAX_STEER_CHARS,
      }"
      data-test="rca-steer-input"
      @keydown="onKeydown"
    >
      <template #strip>
        <AssistantComposerStrip :notice="notice" :sentence-id="noticeId">
          <!-- One row only: a chip that would wrap is hidden whole; the touch padding keeps each chip's 44 px hit area inside the clip -->
          <div
            ref="chipRow"
            class="relative flex h-6 min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-4 overflow-hidden max-md:h-11 max-md:py-2.5 pointer-coarse:h-11 pointer-coarse:py-2.5"
            role="group"
            :aria-label="t('alerts.incidents.rcaSteer.suggestions')"
            data-test="rca-steer-chips"
          >
            <OButton
              v-for="chip in chips"
              :key="chip.id"
              variant="ghost"
              size="chip"
              :class="[
                AGENT_PICKER_CLASS,
                CHIP_HIT_AREA_CLASS,
                'shrink-0',
                overflowed.has(chip.id) && 'invisible',
              ]"
              :data-chip="chip.id"
              :disabled="sending"
              :data-test="`rca-steer-chip-${chip.id}`"
              @click="prefill(chip.label)"
            >
              {{ chip.label }}
            </OButton>
          </div>
          <template #sees>
            <OPopover
              side="top"
              align="end"
              privacy="mask"
              :aria-label="t('assistant.context.title')"
              content-class="w-max max-w-[min(26rem,calc(100vw-1.5rem))] p-3"
            >
              <template #trigger>
                <AssistantIconButton
                  :label="t('assistant.context.title')"
                  :icon="assistantGlyph.info"
                  data-test="rca-steer-sees"
                />
              </template>
              <section class="flex flex-col gap-2" data-test="rca-steer-sees-popover">
                <OText variant="card-title" as="h2">{{ t("assistant.context.title") }}</OText>
                <OText variant="meta" as="p">
                  {{
                    waitingInput
                      ? t("alerts.incidents.rcaSteer.composerHintPaused")
                      : t("alerts.incidents.rcaSteer.composerHintLive")
                  }}
                </OText>
                <OText variant="meta" as="p" data-test="rca-steer-sending-as">
                  {{ t("alerts.incidents.rcaSteer.sendingAs", { email: authorEmail }) }}
                </OText>
                <OText v-if="waitingInput" variant="meta" as="p" data-test="rca-steer-answer-note">
                  {{ t("alerts.incidents.rcaSteer.answerNote") }}
                </OText>
              </section>
            </OPopover>
          </template>
        </AssistantComposerStrip>
      </template>
      <template #bar>
        <AssistantComposerBottomRow>
          <template #agent>
            <AssistantAgentPill agent="sre" />
          </template>
          <AssistantIconButton
            variant="primary"
            size="md"
            :label="t('alerts.incidents.rcaSteer.send')"
            :icon="assistantGlyph.send"
            :disabled="!canSend"
            :loading="sending"
            :class="ROUND_ACTION_CLASS"
            data-test="rca-steer-send-btn"
            @click="submit"
          />
        </AssistantComposerBottomRow>
      </template>
    </AssistantComposerFrame>
    <span v-if="error" role="alert" class="sr-only" data-test="rca-steer-error">{{ error }}</span>
  </form>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";

import AssistantIconButton from "@/components/ai-assistant/common/AssistantIconButton.vue";
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import AssistantAgentPill, {
  AGENT_PICKER_CLASS,
} from "@/components/ai-assistant/composer/AssistantAgentPill.vue";
import AssistantComposerBottomRow, {
  ROUND_ACTION_CLASS,
} from "@/components/ai-assistant/composer/AssistantComposerBottomRow.vue";
import AssistantComposerFrame from "@/components/ai-assistant/composer/AssistantComposerFrame.vue";
import AssistantComposerStrip from "@/components/ai-assistant/composer/AssistantComposerStrip.vue";
import { pickNotice, sentenceNotice } from "@/components/ai-assistant/composer/composerNotice";
import { CHIP_HIT_AREA_CLASS } from "@/components/ai-assistant/composer/composerUi";
import type { RcaSteerSendResult } from "@/composables/useRcaSteering";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import type { RcaOpenQuestion } from "@/services/incidents";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { isClosedRunRefusal } from "@/utils/incidents/rcaSteering";

/** At most 2,000 characters. */
const MAX_STEER_CHARS = 2_000;

const props = withDefaults(
  defineProps<{
    /** The run waits for an answer. */
    waitingInput: boolean;
    openQuestion?: RcaOpenQuestion | null;
    /** The signed-in user's address ("Sending as"). */
    authorEmail: string;
    sending?: boolean;
    /** Sends the text; resolves with the route's answer. */
    send: (text: string) => Promise<RcaSteerSendResult>;
    /** Identifies the run; a new run clears the draft and the error. */
    runId: string;
  }>(),
  { openQuestion: null, sending: false },
);

const { t } = useI18nTyped();
const noticeId = `rca-steer-notice-${useId()}`;
const root = ref<HTMLFormElement | null>(null);

const draft = ref("");
const error = ref<I18nText | null>(null);

watch(
  () => props.runId,
  () => {
    draft.value = "";
    error.value = null;
  },
);

const chips = computed(() => [
  { id: "check", label: t("alerts.incidents.rcaSteer.chipCheck") },
  { id: "ignore", label: t("alerts.incidents.rcaSteer.chipIgnore") },
  { id: "focus", label: t("alerts.incidents.rcaSteer.chipFocus") },
  { id: "changed", label: t("alerts.incidents.rcaSteer.chipChanged") },
]);

const chipRow = ref<HTMLElement | null>(null);
const overflowed = ref<ReadonlySet<string>>(new Set());
let chipObserver: ResizeObserver | null = null;

// A chip laid out below the first row did not fit beside the others.
function measureChips(): void {
  const row = chipRow.value;
  if (!row) return;
  const next = new Set<string>();
  for (const el of row.querySelectorAll<HTMLElement>("[data-chip]"))
    if (el.offsetTop >= el.offsetHeight && el.dataset.chip) next.add(el.dataset.chip);
  const same =
    next.size === overflowed.value.size && [...next].every((id) => overflowed.value.has(id));
  if (!same) overflowed.value = next;
}

onMounted(() => {
  measureChips();
  if (typeof ResizeObserver === "undefined" || !chipRow.value) return;
  chipObserver = new ResizeObserver(measureChips);
  chipObserver.observe(chipRow.value);
});

onBeforeUnmount(() => chipObserver?.disconnect());

// The strip says one thing: a refused send first, then the agent's open question; otherwise the suggestions show.
const notice = computed(() =>
  pickNotice([
    error.value && sentenceNotice("blocked", error.value),
    props.waitingInput &&
      props.openQuestion && {
        ...sentenceNotice("entry", raw(props.openQuestion.question), "info"),
        title: t("alerts.incidents.rcaSteer.agentAsks"),
      },
  ]),
);

const canSend = computed(() => draft.value.trim().length > 0 && !props.sending);

const focus = async () => {
  await nextTick();
  const textarea = root.value?.querySelector("textarea");
  textarea?.focus();
};

/** "Check …" fills "Check " and puts the cursor after it. */
const prefill = (label: string) => {
  draft.value = label.replace(/\s*…$/, " ");
  void focus();
};

const submit = async () => {
  if (!canSend.value) return;
  const text = draft.value.trim();
  error.value = null;
  const result = await props.send(text);
  if (result.ok) {
    draft.value = "";
    return;
  }
  if (isClosedRunRefusal(result.code)) return;
  error.value = result.message;
};

// Enter sends as in every composer; Shift+Enter is a new line.
const onKeydown = (event: KeyboardEvent) => {
  if (event.isComposing || event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  void submit();
};

defineExpose({ focus });
</script>
