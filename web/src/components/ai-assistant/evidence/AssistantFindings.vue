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
  <OText
    v-if="!findings"
    variant="meta"
    as="p"
    class="leading-5"
    data-test="assistant-findings-invalid"
  >
    {{ t("assistant.findings.invalid") }}
  </OText>
  <section
    v-else
    :aria-labelledby="titleId"
    class="flex min-w-0 flex-col gap-2"
    data-test="assistant-findings"
    :data-confidence="findings.confidence"
  >
    <OCard variant="outlined" class="rounded-surface flex min-w-0 flex-col">
      <OCardSection :role="SECTION_HEADER" dense>
        <OText :id="titleId" variant="body-strong" as="h3">
          {{ t("assistant.findings.title") }}
        </OText>
      </OCardSection>
      <OCardSection :role="SECTION_BODY" dense class="flex flex-col gap-3">
        <OText
          v-if="inconclusive"
          variant="body"
          as="p"
          class="break-words"
          data-test="assistant-findings-inconclusive"
        >
          {{ t("assistant.findings.inconclusive") }}
        </OText>
        <div v-else class="flex min-w-0 flex-col gap-1">
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <OText variant="label" as="h4">{{ t("assistant.findings.likelyCause") }}</OText>
            <OTag
              type="assistantConfidence"
              :value="findings.confidence"
              aria-hidden="true"
              data-test="assistant-findings-confidence"
            />
            <span class="sr-only">{{ confidenceName }}</span>
          </div>
          <OText variant="body" as="p" class="break-words" data-test="assistant-findings-cause">
            {{ raw(findings.likelyCause) }}
          </OText>
        </div>
        <div v-if="findings.evidence.length" class="flex min-w-0 flex-col gap-1">
          <OText variant="label" as="h4">{{ t("assistant.findings.evidence") }}</OText>
          <ul class="flex min-w-0 flex-col gap-1.5" data-test="assistant-findings-evidence">
            <li
              v-for="(item, index) in findings.evidence"
              :key="index"
              class="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1 text-sm"
              :data-kind="item.kind"
            >
              <OIcon
                :name="item.kind === 'verified' ? assistantGlyph.verified : assistantGlyph.inferred"
                size="sm"
                class="text-text-secondary mt-0.5 shrink-0"
                aria-hidden="true"
              />
              <OText variant="meta" class="shrink-0">
                {{
                  item.kind === "verified"
                    ? t("assistant.findings.verified")
                    : t("assistant.findings.inferred")
                }}
              </OText>
              <span class="text-text-body min-w-0 flex-1 basis-40 break-words"
                >{{ raw(item.text)
                }}<AssistantClaimChip
                  v-if="item.kind === 'verified' && item.callId && numbers.get(item.callId)"
                  :n="numbers.get(item.callId)!"
                  :call-id="item.callId"
                  :available="!hidden && steps.some((step) => step.callId === item.callId)"
                  :label="citation(item.callId)"
                  :sid="turn?.sid ?? null"
                  :readonly="readonly"
              /></span>
            </li>
          </ul>
        </div>
        <div v-for="list in lists" :key="list.key" class="flex min-w-0 flex-col gap-1">
          <OText variant="label" as="h4">{{ list.title }}</OText>
          <ul
            class="text-text-body flex min-w-0 list-disc flex-col gap-1 ps-5 text-sm"
            :data-test="`assistant-findings-${list.key}`"
          >
            <li v-for="(entry, index) in list.items" :key="index" class="break-words">
              {{ raw(entry) }}
            </li>
          </ul>
        </div>
      </OCardSection>
    </OCard>

    <div
      v-if="canAnswer"
      class="flex min-w-0 flex-col gap-2"
      data-test="assistant-findings-outcome"
    >
      <OToggleGroup
        :model-value="choice ?? undefined"
        type="single"
        :label="t('assistant.findings.wasThisTheCause')"
        label-position="top"
        class="max-md:w-full"
        @update:model-value="(value) => choose(value as Cause)"
      >
        <OToggleGroupItem
          v-for="option in OPTIONS"
          :key="option.value"
          :value="option.value"
          :disabled="sending"
          size="sm"
          class="max-md:min-h-11 max-md:flex-1 pointer-coarse:min-h-11"
          :data-test="`assistant-findings-outcome-${option.slug}`"
        >
          {{ t(option.label) }}
        </OToggleGroupItem>
      </OToggleGroup>
      <div v-if="choice === 'cause:no' && !sent" class="flex min-w-0 flex-col gap-2">
        <OTextarea
          v-model="comment"
          :label="t('assistant.findings.comment')"
          :rows="1"
          width="full"
          data-test="assistant-findings-comment"
        />
        <OButton
          variant="secondary"
          size="sm"
          :loading="sending"
          :class="['self-start max-md:w-full', TOUCH_TARGET_CLASS]"
          data-test="assistant-findings-send"
          @click="send('cause:no')"
        >
          {{ t("assistant.findings.send") }}
        </OButton>
      </div>
      <OText v-if="sent" variant="meta" as="p" data-test="assistant-findings-thanks">
        {{ t("assistant.findings.thanks") }}
      </OText>
      <div v-else-if="failed" class="flex min-w-0 flex-wrap items-center gap-2">
        <OText variant="meta" as="p" data-test="assistant-findings-failed">
          {{ t("assistant.findings.failed") }}
        </OText>
        <OButton
          variant="secondary"
          size="sm"
          :class="TOUCH_TARGET_CLASS"
          data-test="assistant-findings-retry"
          @click="retry"
        >
          {{ t("assistant.findings.retry") }}
        </OButton>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, onMounted, ref, useId } from "vue";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import {
  assistantEvidenceHostKey,
  claimNumbers,
  stepsOf,
  turnAnnotationKey,
  type AssistantTurnView,
} from "@/composables/assistant/pure";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OToggleGroup from "@/lib/core/ToggleGroup/OToggleGroup.vue";
import OToggleGroupItem from "@/lib/core/ToggleGroup/OToggleGroupItem.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTextarea from "@/lib/forms/Input/OTextarea.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import type { ChatMessage, ContentBlock } from "@/ts/interfaces/chat";
import { raw, useI18nTyped, type I18nKey, type I18nText } from "@/types/i18n";

import AssistantClaimChip from "./AssistantClaimChip.vue";
import { claimNumbersKey, stepCitation } from "./evidenceText";

type Cause = "cause:yes" | "cause:no" | "cause:unsure";

const OPTIONS: { value: Cause; slug: string; label: I18nKey }[] = [
  { value: "cause:yes", slug: "yes", label: "assistant.findings.yes" },
  { value: "cause:no", slug: "no", label: "assistant.findings.no" },
  { value: "cause:unsure", slug: "unsure", label: "assistant.findings.notSure" },
];

// OCardSection's own zones; bound, as its `role` prop is not an ARIA role.
const SECTION_HEADER = "header" as const;

const SECTION_BODY = "body" as const;

// A block counts once per page load, so a re-render never repeats the event.
const reported = new Set<string>();

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
const injectedNumbers = inject(claimNumbersKey, null);
const titleId = useId();

const comment = ref("");
const sending = ref(false);
const failed = ref<Cause | null>(null);
const picked = ref<Cause | null>(null);

const findings = computed(() => props.block?.findings ?? null);
const inconclusive = computed(() => findings.value?.confidence === "inconclusive");
const hidden = computed(() => props.turn?.hiddenByOwner === true);
const steps = computed(() => stepsOf(props.message, props.turn?.org ?? ""));
const numbers = computed(
  () =>
    injectedNumbers?.value ??
    claimNumbers(
      (findings.value?.evidence ?? []).flatMap((item) => (item.callId ? [item.callId] : [])),
    ),
);

const confidenceName = computed(() =>
  t("assistant.findings.confidence", {
    level: t(`assistant.findings.level.${findings.value?.confidence ?? "low"}`),
  }),
);

const lists = computed(() => {
  const current = findings.value;
  if (!current) return [];
  return [
    { key: "ruled-out", title: t("assistant.findings.ruledOut"), items: current.ruledOut },
    { key: "unknown", title: t("assistant.findings.unknown"), items: current.unknowns },
    { key: "next-steps", title: t("assistant.findings.nextSteps"), items: current.nextSteps },
  ].filter((list) => list.items.length > 0);
});

const sid = computed(() => props.turn?.sid ?? null);
const annotationKey = computed(() => turnAnnotationKey(props.turn?.turnId ?? "", "findings"));
const stored = computed(() => {
  const session = sid.value && evidence ? evidence.session(sid.value) : null;
  return session?.annotations[annotationKey.value]?.feedback ?? null;
});
const sent = computed(() => !!stored.value);
const choice = computed<Cause | null>(
  () => OPTIONS.find((option) => option.value === stored.value?.reason)?.value ?? picked.value,
);
// Outcome feedback is only for a finished answer in the reader's own chat.
const canAnswer = computed(
  () =>
    !props.readonly &&
    !!evidence &&
    !!sid.value &&
    props.turn?.outcome === "done" &&
    !!findings.value,
);

function citation(callId: string): I18nText {
  const step = steps.value.find((candidate) => candidate.callId === callId);
  return step ? stepCitation(step, t) : t("assistant.claim.notAvailable");
}

function choose(value: Cause | undefined): void {
  if (!value || sending.value || sent.value) return;
  picked.value = value;
  if (value !== "cause:no") void send(value);
}

function retry(): void {
  if (failed.value) void send(failed.value);
}

async function send(value: Cause): Promise<void> {
  if (!sid.value || !evidence || !props.turn || sending.value) return;
  sending.value = true;
  failed.value = null;
  const result = await evidence.dispatch(sid.value, {
    kind: "feedback",
    messageId: props.turn.turnId,
    vote: value === "cause:yes" ? "up" : "down",
    reason: value,
    ...(value === "cause:no" && comment.value.trim() && { comment: comment.value.trim() }),
  });
  sending.value = false;
  // A failed pick is cleared so the toggle can be chosen again.
  if (!result.ok) picked.value = null;
  failed.value = result.ok ? null : value;
  evidence.announce(
    sid.value,
    result.ok ? t("assistant.findings.thanks") : t("assistant.findings.failed"),
  );
}

onMounted(() => {
  if (findings.value || !props.blockId || reported.has(props.blockId)) return;
  reported.add(props.blockId);
  trackAssistant("ai_block_invalid", { block_kind: "findings" });
});
</script>
