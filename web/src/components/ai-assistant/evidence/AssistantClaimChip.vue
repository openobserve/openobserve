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
  <span ref="root" class="ms-1 inline-flex items-center align-middle">
    <OPopover
      v-if="available && step"
      v-model:open="peeking"
      :auto-focus="refocus"
      privacy="mask"
      side="bottom"
      align="start"
      :aria-label="peekTitle"
      content-class="flex w-[min(25rem,calc(100vw-1.5rem))] flex-col gap-2 p-3"
    >
      <template #trigger>
        <OTag
          type="assistantClaim"
          value="available"
          :label="number"
          clickable
          :aria-label="name"
          :class="[HIT_AREA, peeking && 'ring-border-strong rounded-default ring-2']"
          :data-test="`assistant-claim-${n}`"
          :data-call-id="callId"
        />
      </template>
      <OText variant="label" as="p" data-test="assistant-claim-peek-title">{{ peekTitle }}</OText>
      <AssistantStepEvidence
        :step="step"
        surface="claim"
        :sid="sid"
        :readonly="readonly"
        :openable="openable"
        @show-in-steps="showInSteps"
      />
    </OPopover>
    <OTag
      v-else-if="available"
      type="assistantClaim"
      value="available"
      :label="number"
      clickable
      :aria-label="name"
      :class="HIT_AREA"
      :data-test="`assistant-claim-${n}`"
      :data-call-id="callId"
      @click="open"
    />
    <span
      v-else
      tabindex="0"
      role="note"
      :aria-label="mutedName"
      :class="[
        'rounded-default focus-visible:ring-border-strong inline-flex items-center outline-none focus-visible:ring-2',
        HIT_AREA,
      ]"
      :data-test="`assistant-claim-${n}`"
      data-muted=""
    >
      <OTag type="assistantClaim" value="muted" :label="number" />
      <OTooltip :content="t('assistant.claim.notAvailable')" />
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";

import { assistantEvidenceHostKey, type Sid, type StepFacts } from "@/composables/assistant/pure";
import OTag from "@/lib/core/Badge/OTag.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OPopover from "@/lib/overlay/Popover/OPopover.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

import AssistantStepEvidence from "./AssistantStepEvidence.vue";
import { revealStep } from "./revealStep";
import { useStepActions } from "./useStepActions";

const HIT_AREA =
  "relative max-md:before:absolute max-md:before:top-1/2 max-md:before:left-1/2 max-md:before:size-11 max-md:before:-translate-x-1/2 max-md:before:-translate-y-1/2 max-md:before:content-[''] pointer-coarse:before:absolute pointer-coarse:before:top-1/2 pointer-coarse:before:left-1/2 pointer-coarse:before:size-11 pointer-coarse:before:-translate-x-1/2 pointer-coarse:before:-translate-y-1/2 pointer-coarse:before:content-['']";

const props = withDefaults(
  defineProps<{
    n: number;
    callId: string;
    available: boolean;
    /** "Queried default · 13:43–13:58 IST": what the step did. */
    label: I18nText;
    /** The cited step; with it the chip opens an evidence peek in place instead of jumping (D3-j). */
    step?: StepFacts | null;
    /** Steps in the answer's trail, for "step {i} of {total}". */
    total?: number;
    openable?: boolean;
    sid?: Sid | null;
    readonly?: boolean;
  }>(),
  { step: null, total: 0, openable: true, sid: null, readonly: false },
);

const { t } = useI18nTyped();
const host = props.readonly ? null : inject(assistantEvidenceHostKey, null);
const root = ref<HTMLElement | null>(null);
const peeking = ref(false);
// Show in steps moves focus to the trail, so closing the peek must not pull it back to the chip.
const refocus = ref(true);
const actions = useStepActions(
  () => props.sid,
  () => props.readonly,
  "claim",
);

const number = computed(() => raw(String(props.n)));
const name = computed(() => t("assistant.claim.name", { n: props.n, step: props.label }));
const peekTitle = computed(() => {
  const title = t("assistant.claim.peekTitle", { n: props.n });
  if (!props.step || !props.total) return title;
  return t("assistant.turn.withElapsed", {
    status: title,
    elapsed: t("assistant.claim.stepOf", { i: props.step.n, total: props.total }),
  });
});
const mutedName = computed(() =>
  t("assistant.claim.name", { n: props.n, step: t("assistant.claim.notAvailable") }),
);

async function showInSteps(): Promise<void> {
  refocus.value = false;
  peeking.value = false;
  if (props.step) await actions.showInSteps(props.step, root.value);
}

watch(peeking, (open) => {
  if (open) refocus.value = true;
});

async function open(): Promise<void> {
  if (props.sid && host)
    await host.dispatch(props.sid, { kind: "open_step", callId: props.callId });
  await revealStep(root.value, props.callId);
}
</script>
