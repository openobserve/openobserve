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

<!-- The steer box pinned under the thread (04 SG37, §3 frames F and D): title,
     the open question and the answer note while paused, prefill chips, the
     message, "Sending as …" and Send. Refusals show inline (§9.1); a run that
     takes no more messages is reported by the column that owns `send`. -->
<template>
  <form
    ref="root"
    data-test="rca-steer-composer"
    class="border-border-default bg-surface-base flex flex-none flex-col gap-2 border-t px-4 pt-3 pb-3.5"
    @submit.prevent="submit"
  >
    <div class="flex items-baseline gap-2">
      <label :for="textareaId" class="text-text-heading text-compact font-bold">
        {{
          waitingInput
            ? t("alerts.incidents.rcaSteer.composerTitlePaused")
            : t("alerts.incidents.rcaSteer.composerTitleLive")
        }}
      </label>
      <span class="text-text-secondary text-xs">
        {{
          waitingInput
            ? t("alerts.incidents.rcaSteer.composerHintPaused")
            : t("alerts.incidents.rcaSteer.composerHintLive")
        }}
      </span>
    </div>

    <template v-if="waitingInput">
      <p
        v-if="openQuestion"
        data-test="rca-steer-question"
        class="text-text-body text-compact m-0 break-words"
      >
        <span class="text-text-heading font-semibold">
          {{ t("alerts.incidents.rcaSteer.agentAsks") }}:
        </span>
        {{ openQuestion.question }}
      </p>
      <p
        data-test="rca-steer-answer-note"
        class="text-status-warning-text m-0 flex items-start gap-1.5 text-xs"
      >
        <OIcon name="info" size="xs" class="mt-px shrink-0" />
        {{ t("alerts.incidents.rcaSteer.answerNote") }}
      </p>
    </template>

    <div
      class="flex flex-wrap gap-1.5"
      role="group"
      :aria-label="t('alerts.incidents.rcaSteer.suggestions')"
    >
      <button
        v-for="chip in chips"
        :key="chip.id"
        type="button"
        :data-test="`rca-steer-chip-${chip.id}`"
        class="border-border-control text-text-body hover:bg-surface-subtle-hover bg-surface-base inline-flex h-6.5 cursor-pointer items-center rounded-full border px-2.5 text-xs"
        @click="prefill(chip.label)"
      >
        {{ chip.label }}
      </button>
    </div>

    <OTextarea
      :id="textareaId"
      v-model="draft"
      data-test="rca-steer-input"
      :rows="3"
      :maxlength="MAX_STEER_CHARS"
      :placeholder="
        waitingInput
          ? t('alerts.incidents.rcaSteer.placeholderPaused')
          : t('alerts.incidents.rcaSteer.placeholderLive')
      "
      :disabled="sending"
      @keydown="onKeydown"
    />

    <p
      v-if="error"
      data-test="rca-steer-error"
      role="alert"
      class="text-status-error-text m-0 text-xs"
    >
      {{ error }}
    </p>

    <div class="flex items-center gap-2">
      <span data-test="rca-steer-sending-as" class="text-text-secondary min-w-0 flex-1 text-xs">
        {{ t("alerts.incidents.rcaSteer.sendingAs", { email: authorEmail }) }}
      </span>
      <OButton
        data-test="rca-steer-send-btn"
        type="submit"
        variant="primary"
        size="sm"
        icon-left="send"
        :disabled="!canSend"
        :loading="sending"
      >
        {{ t("alerts.incidents.rcaSteer.send") }}
      </OButton>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";
import type { RcaOpenQuestion } from "@/services/incidents";
import type { RcaSteerSendResult } from "@/composables/useRcaSteering";
import { isClosedRunRefusal } from "@/utils/incidents/rcaSteering";

/** SG8: at most 2,000 characters. */
const MAX_STEER_CHARS = 2_000;

const props = withDefaults(
  defineProps<{
    /** The run waits for an answer (frame D). */
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
const textareaId = useId();
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
  // A closed run (04 §13, SG40): the column that owns `send` keeps the text and
  // offers it as guidance, also after this box hides; the draft stays too.
  if (isClosedRunRefusal(result.code)) return;
  error.value = result.message;
};

// Ctrl/Cmd+Enter sends.
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void submit();
  }
};

defineExpose({ focus });
</script>
