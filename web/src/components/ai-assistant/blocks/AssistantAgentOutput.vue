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
  <OCard data-dd-privacy="mask" :data-test="dataTest" :data-kind="kind">
    <OCardSection :role="SECTION_HEADER" dense class="flex-wrap">
      <OText variant="card-title">{{ title }}</OText>
      <span v-if="bylineText" class="text-text-secondary text-xs" data-test="agent-output-byline">{{
        bylineText
      }}</span>
      <OTag v-if="badge" variant="default-outline" size="sm" class="ms-auto">{{ badge }}</OTag>
    </OCardSection>
    <OCardSection :role="SECTION_BODY" dense class="flex min-w-0 flex-col gap-2">
      <p v-if="sentence" class="flex min-w-0 flex-wrap items-center gap-2">
        <OTag
          v-if="tag && !refusal"
          variant="warning-soft"
          size="sm"
          data-test="agent-output-tag"
          >{{ tag }}</OTag
        >
        <OText
          as="span"
          variant="body"
          :class="['min-w-0 break-words', refusal && 'text-text-secondary']"
          :data-test="refusal ? 'agent-output-refusal' : 'agent-output-verdict'"
          >{{ raw(sentence) }}</OText
        >
      </p>
      <OText
        v-if="confidence"
        variant="meta"
        class="break-words"
        data-test="agent-output-confidence"
        >{{
          t("assistant.findings.confidence", { level: t(`assistant.findings.level.${confidence}`) })
        }}</OText
      >
      <ul
        v-if="evidence.length"
        class="flex min-w-0 flex-col gap-1"
        data-test="agent-output-evidence"
      >
        <li
          v-for="(item, i) in evidence"
          :key="i"
          class="flex min-w-0 flex-wrap items-center gap-x-2 break-words"
        >
          <OText variant="meta" as="span" class="min-w-0 break-words">{{ raw(item.text) }}</OText>
          <OButton
            v-if="item.href"
            variant="ghost-primary"
            size="xs"
            as="a"
            :href="item.href"
            target="_blank"
            rel="noopener noreferrer"
            :icon-right="assistantGlyph.newTab"
            :aria-label="t('assistant.approval.result.open', { name: raw(item.text) })"
            :class="['shrink-0', TOUCH_TARGET_CLASS]"
            :data-test="`agent-output-evidence-open-${i}`"
          >
            {{ t("assistant.approval.open") }}
          </OButton>
        </li>
      </ul>
      <p
        v-for="(note, i) in notes"
        :key="i"
        class="flex min-w-0 flex-wrap items-center gap-2"
        data-test="agent-output-note"
      >
        <OTag v-if="note.tag" variant="warning-soft" size="sm" data-test="agent-output-note-tag">{{
          note.tag
        }}</OTag>
        <OText as="span" :variant="note.meta ? 'meta' : 'body'" class="min-w-0 break-words">{{
          raw(note.text)
        }}</OText>
      </p>
      <div
        v-if="message"
        class="min-w-0 break-words"
        :aria-busy="live"
        data-test="agent-output-report"
      >
        <AssistantMessage :message="message" :turn-id="reportKey" :live="live" readonly />
      </div>
      <div v-if="$slots.door" class="flex flex-wrap items-center gap-2 max-md:[&>*]:w-full">
        <slot name="door" />
      </div>
    </OCardSection>
  </OCard>
</template>

<script lang="ts">
import type { FindingsData } from "@/composables/assistant/pure";
import type { I18nText } from "@/types/i18n";

/** A line under the sentence; server lines are shown verbatim in body text. */
export interface AgentNote {
  text: string;
  /** A short label before the line, such as an applied severity change. */
  tag?: I18nText;
  /** A product explanation rather than the agent's words. */
  meta?: boolean;
}

/** One evidence row an agent cited; rendered only when the server sends it. */
export interface AgentEvidence {
  text: string;
  /** Already checked by the caller to be `http(s)` or a same-origin path. */
  href?: string;
}

export interface AssistantAgentOutputProps {
  kind: "oncall_verdict" | "oncall_report" | "autoobserve_ask" | "incident_report";
  title: I18nText;
  byline?: I18nText;
  /** The model that wrote it; shown before the byline to admins only. */
  model?: string;
  badge?: I18nText;
  /** The agent's own one-sentence conclusion, shown verbatim. */
  sentence?: string;
  /** The sentence is a refusal: a neutral line, never an error and never tagged. */
  refusal?: boolean;
  /** A short label before the sentence, such as an applied severity change. */
  tag?: I18nText;
  /** Only when the server sends it; never a placeholder. */
  confidence?: "high" | "medium" | "low" | "inconclusive";
  evidence?: AgentEvidence[];
  findings?: FindingsData | null;
  notes?: AgentNote[];
  /** Markdown, rendered through the assistant's strict renderer. */
  report?: string;
  /** The report is still arriving. */
  live?: boolean;
  /** Distinguishes renders of the same report in the markdown cache. */
  reportId?: string;
  dataTest?: string;
}
</script>

<script setup lang="ts">
import { computed } from "vue";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { TOUCH_TARGET_CLASS } from "@/components/ai-assistant/common/touchTarget";
import AssistantMessage from "@/components/ai-assistant/transcript/AssistantMessage.vue";
import { useAssistantCapability } from "@/composables/assistant";
import { markdownMessage } from "@/composables/assistant/pure";
import OTag from "@/lib/core/Badge/OTag.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OCardSection from "@/lib/core/Card/OCardSection.vue";
import OText from "@/lib/core/Typography/OText.vue";
import type { ChatMessage } from "@/ts/interfaces/chat";
import { raw, useI18nTyped } from "@/types/i18n";

// OCardSection's own zones; bound, as its `role` prop is not an ARIA role.
const SECTION_HEADER = "header" as const;
const SECTION_BODY = "body" as const;

const props = withDefaults(defineProps<AssistantAgentOutputProps>(), {
  byline: undefined,
  model: undefined,
  badge: undefined,
  sentence: undefined,
  refusal: false,
  tag: undefined,
  confidence: undefined,
  evidence: () => [],
  findings: null,
  notes: () => [],
  report: undefined,
  live: false,
  reportId: "report",
  dataTest: "assistant-agent-output",
});

const { t } = useI18nTyped();

const message = computed<ChatMessage | null>(() => {
  const text = props.report?.trim() ?? "";
  if (!text && !props.findings) return null;
  return markdownMessage(
    text,
    props.findings ? [{ type: "findings", findings: props.findings }] : [],
  );
});

const capability = useAssistantCapability();
// Model names are an admin detail; members see only the byline.
const bylineText = computed(() => {
  const model = capability.value.isAdmin ? props.model : undefined;
  if (model && props.byline) return raw(`${model} · ${props.byline}`);
  return model ? raw(model) : props.byline;
});

const reportKey = computed(() => `agent-output:${props.kind}:${props.reportId}`);
</script>
