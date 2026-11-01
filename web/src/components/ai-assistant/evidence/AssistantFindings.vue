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
  <div v-if="!findings" class="flex min-w-0 flex-col gap-1" data-test="assistant-findings-invalid">
    <OText variant="meta" as="p">{{ t("assistant.findings.unreadable") }}</OText>
    <OCollapsible
      :label="t('assistant.findings.showRaw')"
      :trigger-class="TOUCH_TARGET_CLASS"
      data-test="assistant-findings-raw"
    >
      <OCodeBlock
        :code="rawText"
        lang="json"
        contrast="aa"
        :scroll-label="t('assistant.findings.showRaw')"
        :copy-message="t('assistant.evidence.copied')"
      />
    </OCollapsible>
  </div>
  <section
    v-else
    class="flex min-w-0 flex-col gap-2"
    data-test="assistant-findings"
    :data-confidence="findings.confidence"
  >
    <p
      class="text-text-heading text-sm font-medium break-words"
      data-test="assistant-findings-cause"
    >
      {{ raw(findings.likelyCause) }}
    </p>
    <AssistantAnswerMeta
      :message="message"
      :turn="turn"
      :readonly="readonly"
      :confidence="findings.confidence"
    />
    <ul
      v-if="verified.length"
      class="text-text-body marker:text-text-secondary flex min-w-0 list-disc flex-col gap-0.5 ps-3 text-sm"
      data-test="assistant-findings-evidence"
    >
      <li v-for="(item, index) in verified" :key="index" class="break-words" :data-kind="item.kind">
        {{ raw(item.text)
        }}<AssistantClaimChip
          v-if="item.callId && numbers.get(item.callId)"
          :n="numbers.get(item.callId)!"
          :call-id="item.callId"
          :available="!hidden && steps.some((step) => step.callId === item.callId)"
          :label="citation(item.callId)"
        />
      </li>
    </ul>
    <p
      v-for="line in lines"
      :key="line.key"
      class="text-text-secondary text-sm break-words"
      :data-test="`assistant-findings-${line.key}`"
    >
      {{ line.text }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, onMounted } from "vue";

import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import { claimNumbers, stepsOf, type AssistantTurnView } from "@/composables/assistant/pure";
import OCodeBlock from "@/lib/core/Code/OCodeBlock.vue";
import OCollapsible from "@/lib/core/Collapsible/OCollapsible.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { trackAssistant } from "@/services/assistantAnalytics";
import type { ChatMessage, ContentBlock } from "@/ts/interfaces/chat";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

import AssistantAnswerMeta from "./AssistantAnswerMeta.vue";
import AssistantClaimChip from "./AssistantClaimChip.vue";
import { citationName, claimNumbersKey } from "./evidenceText";

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
const injectedNumbers = inject(claimNumbersKey, null);

const findings = computed(() => props.block?.findings ?? null);
const hidden = computed(() => props.turn?.hiddenByOwner === true);
const steps = computed(() => stepsOf(props.message, props.turn?.org ?? ""));
const numbers = computed(
  () =>
    injectedNumbers?.value ??
    claimNumbers(
      (findings.value?.evidence ?? []).flatMap((item) => (item.callId ? [item.callId] : [])),
    ),
);
const verified = computed(() =>
  (findings.value?.evidence ?? []).filter((item) => item.kind === "verified"),
);
const rawText = computed(() => JSON.stringify(props.block ?? {}, null, 2));

// Follow-ups are the next step, so the Next line would say it twice.
const followUpsSent = computed(
  () => !!props.message.contentBlocks?.some((block) => block.type === "follow_ups"),
);

const lines = computed<{ key: string; text: I18nText }[]>(() => {
  const current = findings.value;
  if (!current) return [];
  const inferred = current.evidence.filter((item) => item.kind === "inferred");
  const next = followUpsSent.value ? [] : current.nextSteps.slice(0, 1);
  const list = (items: string[]) => ({ text: raw(items.join("; ")) });
  return [
    inferred.length && {
      key: "inferred",
      text: t("assistant.findings.inferredLine", list(inferred.map((item) => item.text))),
    },
    current.ruledOut.length && {
      key: "ruled-out",
      text: t("assistant.findings.ruledOutLine", list(current.ruledOut)),
    },
    current.unknowns.length && {
      key: "unknown",
      text: t("assistant.findings.notEstablished", list(current.unknowns)),
    },
    next.length && { key: "next-steps", text: t("assistant.findings.next", list(next)) },
  ].filter((line) => !!line);
});

function citation(callId: string): I18nText {
  const step = steps.value.find((candidate) => candidate.callId === callId);
  return step
    ? citationName(numbers.value.get(callId) ?? step.n, step, t)
    : t("assistant.claim.notAvailable");
}

onMounted(() => {
  if (findings.value || !props.blockId || reported.has(props.blockId)) return;
  reported.add(props.blockId);
  trackAssistant("ai_block_invalid", { block_kind: "findings" });
});
</script>
