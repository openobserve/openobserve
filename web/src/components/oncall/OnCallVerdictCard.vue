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

<!--
  The L0 agent's verdict, surfaced where the responder reads at 3am (C13).

  The timeline renders the same events as rows; this card exists because a
  machine recommendation that decided who got woken must not be buried
  mid-thread. The bodies are the server's own sentences — cause, confidence,
  report reference, recommendation, and what the engine did with the severity
  suggestion — rendered verbatim, never recomposed (the structured verdict
  never reaches the wire; the sentence is the contract).

  §G.7: the default deployment has no agent and emits no event, and it is
  indistinguishable from a broken one. So this card renders NOTHING until a
  verdict event exists — an "analysis" panel that sits empty forever would
  read as a product defect on every deployment without L0.

  C14 rides here too: a promotion is its own line, appended — never an edit
  to anything already shown — and the server's sentence carries both facts
  (asked-for beside applied, including the clamped and refused cases).
-->
<template>
  <template v-if="assistantV2">
    <span class="sr-only" role="status" data-test="oncall-verdict-announce">{{
      announcement
    }}</span>
    <AssistantAgentOutput
      v-if="verdict"
      kind="oncall_verdict"
      :title="t('oncall.verdictByAssistant', { product })"
      :byline="byline"
      :sentence="verdict.body"
      :notes="notes"
      data-test="oncall-verdict-card"
    >
      <template v-if="verdict.body.trim()" #door>
        <AiEntryButton
          verb="ask"
          entry-kind="oncall_card"
          object-kind="alert_firing"
          thread="new"
          :build="buildContinue"
          :label="t('assistant.oncall.continue')"
          :tooltip="t('assistant.oncall.prompt')"
          data-test="ai-entry-oncall-verdict-ask"
        />
      </template>
    </AssistantAgentOutput>
  </template>
  <OCard v-else-if="verdict" variant="glass" data-test="oncall-verdict-card">
    <OCardSection role="header" dense class="flex-wrap">
      <OText variant="card-title">{{ t("oncall.verdictTitle") }}</OText>
      <span class="text-text-secondary text-xs">
        {{ raw(verdict.actor) }} · <OTimeCell :value="verdict.at" unit="us" />
      </span>
    </OCardSection>

    <OCardSection role="body" dense class="flex flex-col gap-2">
      <p class="text-text-body text-sm" data-test="oncall-verdict-body">
        {{ raw(verdict.body) }}
      </p>

      <!-- Two facts, one line, the server's words: what was asked for and what
         was applied. A clamped or refused promotion is the feature working. -->
      <p
        v-if="promotion"
        class="text-status-error-text text-sm"
        data-test="oncall-verdict-promotion"
      >
        {{ raw(promotion.body) }}
      </p>

      <!-- The verdict never edits the page that already went out — it rides as
         one follow-up. Saying so heads off "why didn't my page update". -->
      <span class="text-text-secondary text-xs">{{ t("oncall.verdictFollowUpNote") }}</span>
    </OCardSection>
  </OCard>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { useStore } from "vuex";

import { isAssistantV2 } from "@/composables/assistant/flags";
import { useAssistantName } from "@/composables/assistant/pure";
import type { AgentNote } from "@/components/ai-assistant/blocks/AssistantAgentOutput.vue";
import { buildOnCallVerdictPrompt } from "@/utils/assistant/prompts/oncall";

import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OTimeCell from "@/lib/core/Table/cells/OTimeCell.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { OnCallResponseEvent } from "@/ts/interfaces/oncall";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";
import { formatOrgTime } from "@/utils/formatters";
import { appliedPromotionOf, firstSentenceOf } from "@/utils/oncall/verdictText";

const AssistantAgentOutput = defineAsyncComponent(
  () => import("@/components/ai-assistant/blocks/AssistantAgentOutput.vue"),
);
const AiEntryButton = defineAsyncComponent(
  () => import("@/components/ai-assistant/entry/AiEntryButton.vue"),
);

const props = withDefaults(
  defineProps<{ events?: OnCallResponseEvent[]; subjectId?: string; subjectName?: string }>(),
  { events: () => [], subjectId: "", subjectName: "" },
);

const { t } = useI18nTyped();
const vuex = useStore();
const assistantV2 = isAssistantV2();
const { product } = useAssistantName();

/// The latest of each kind: attach_verdict is idempotent and a second verdict
/// for the same firing overwrites the analysis, so the newest event is the
/// one that stands.
function latest(kind: OnCallResponseEvent["kind"]): OnCallResponseEvent | null {
  const matching = props.events.filter((event) => event.kind === kind);
  return matching.length ? matching.reduce((a, b) => (b.at >= a.at ? b : a)) : null;
}

const verdict = computed(() => latest("ai_verdict"));
const promotion = computed(() => latest("severity_promoted"));

// Only a verdict that landed after the first page went out rode as a follow-up.
const followedUp = computed(() => {
  const page = props.events.find((event) => event.kind === "page");
  return !!verdict.value && !!page && verdict.value.at > page.at;
});

const notes = computed<AgentNote[]>(() => {
  const lines: AgentNote[] = [];
  const line = promotion.value;
  if (line) {
    const raised = appliedPromotionOf(line.body);
    lines.push({
      text: line.body,
      ...(raised && { tag: t("oncall.severityRaised", { severity: raw(raised) }) }),
    });
  }
  if (followedUp.value) lines.push({ text: t("oncall.verdictFollowUpNote"), meta: true });
  return lines;
});

const byline = computed(() =>
  verdict.value
    ? raw(`${verdict.value.actor} · ${formatOrgTime(verdict.value.at / 1000)}`)
    : undefined,
);

const announcement = ref<I18nText | string>("");
// A verdict already on the page at open is read with it; only a new arrival is announced.
watch(
  () => verdict.value?.at ?? null,
  (at, before) => {
    if (at === null || before !== null || !verdict.value) return;
    announcement.value = t("oncall.verdictArrived", {
      sentence: raw(firstSentenceOf(verdict.value.body)),
    });
  },
);

function buildContinue() {
  const current = verdict.value;
  const prompt = buildOnCallVerdictPrompt({
    org: vuex.state.selectedOrganization?.identifier ?? "",
    id: props.subjectId || String(current?.at ?? ""),
    name: props.subjectName,
    verdict: current?.body ?? "",
  });
  return { text: prompt.text, chips: prompt.chips, title: prompt.title };
}
</script>
