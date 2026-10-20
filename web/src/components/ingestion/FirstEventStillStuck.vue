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

<script setup lang="ts">
import { computed, defineAsyncComponent, inject } from "vue";
import { isAssistantV2 } from "@/composables/assistant/flags";
import OButton from "@/lib/core/Button/OButton.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { FIRST_EVENT_ASK_AI, type AskAiContext } from "./firstEventAskAi";

const props = defineProps<{
  guideName: string;
  docUrl?: string;
  askAiQuery?: string;
  askAiContext?: AskAiContext;
  doorShown?: boolean;
}>();

// template whitespace between elements is condensed away, so the spaces live in the separator itself
const SEPARATOR = raw(" · ");

const { t } = useI18nTyped();
const askAi = inject(FIRST_EVENT_ASK_AI, null);

const showAskAi = computed(() => !!askAi && !!props.askAiQuery);

const assistantV2 = isAssistantV2();
const AiEntryButton = defineAsyncComponent(
  () => import("@/components/ai-assistant/entry/AiEntryButton.vue"),
);
// The door sends the English builder's prompt, never the localised guide text.
const ingestionDoor = computed(() => ({
  verb: "troubleshoot" as const,
  entryKind: "empty_state" as const,
  objectKind: "ingestion" as const,
  label: t("assistant.entry.setUpIngestion"),
  tooltip: t("assistant.entry.tooltip.ingestion"),
  dataTest: "ai-entry-ingestion-troubleshoot" as const,
  build: async () => {
    const context = props.askAiContext;
    if (!context) throw new Error("no diagnosis");
    return (await import("@/utils/assistant/prompts")).buildIngestionPrompt(context);
  },
}));
const docsLabel = computed(() =>
  props.guideName
    ? t("ingestion.firstEvent.guideDocs", { guide: raw(props.guideName) })
    : t("ingestion.firstEvent.setupDocs"),
);

const onAskAi = () => {
  if (props.askAiQuery) askAi?.(props.askAiQuery);
};
</script>

<template>
  <span class="text-text-secondary" data-test="first-event-diagnosis-still-stuck">
    {{ t("ingestion.firstEvent.stillStuck") }}
    <template v-if="assistantV2 && askAiContext && doorShown">
      <AiEntryButton v-bind="ingestionDoor" appearance="chip" />
      <span v-if="docUrl" aria-hidden="true">{{ SEPARATOR }}</span>
    </template>
    <template v-else-if="!assistantV2 && showAskAi">
      <OButton
        variant="ghost-primary"
        size="xs"
        class="text-text-link inline-flex"
        data-test="first-event-diagnosis-ask-ai-btn"
        @click="onAskAi"
      >
        {{ t("ingestion.firstEvent.askAi") }}
      </OButton>
      <span v-if="docUrl" aria-hidden="true">{{ SEPARATOR }}</span>
    </template>
    <a
      v-if="docUrl"
      :href="docUrl"
      target="_blank"
      rel="noopener noreferrer"
      class="text-text-link hover:text-text-link-hover"
      data-test="first-event-diagnosis-docs-link"
      >{{ docsLabel }}</a
    >
  </span>
</template>
