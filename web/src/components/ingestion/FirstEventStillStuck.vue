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
import { computed, inject } from "vue";
import OButton from "@/lib/core/Button/OButton.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { FIRST_EVENT_ASK_AI } from "./firstEventAskAi";

const props = defineProps<{
  guideName: string;
  docUrl?: string;
  askAiQuery?: string;
}>();

// template whitespace between elements is condensed away, so the spaces live in the separator itself
const SEPARATOR = raw(" · ");

const { t } = useI18nTyped();
const askAi = inject(FIRST_EVENT_ASK_AI, null);

const showAskAi = computed(() => !!askAi && !!props.askAiQuery);
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
    <template v-if="showAskAi">
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
