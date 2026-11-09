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
  <EmptyStateActionCard
    v-if="canBrief"
    :icon="assistantGlyph.sparkle"
    :label="t('home.agent.briefMe')"
    :sublabel="t('home.agent.briefMeHint')"
    class="max-w-none! flex-none! basis-auto"
    data-test="agent-home-brief-me"
    @click="briefMe"
  />
</template>

<script setup lang="ts">
import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { openAssistant, type ComposerState } from "@/composables/assistant";
import EmptyStateActionCard from "@/lib/core/EmptyState/EmptyStateActionCard.vue";
import { useI18nTyped } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    /** Brief me is offered only while the agent can answer. */
    canBrief: boolean;
    pageRange?: ComposerState["timeOverride"];
  }>(),
  { pageRange: null },
);

const { t } = useI18nTyped();

// Staged, never sent: the user reads the question before any credit is spent.
function briefMe(): void {
  void openAssistant({
    entryKind: "home_launcher",
    entryVerb: "ask",
    objectKind: "none",
    intent: "stage",
    thread: "new",
    container: "full",
    payload: {
      text: t("home.agent.briefMePrompt"),
      chips: [],
      ...(props.pageRange && { timeOverride: props.pageRange }),
    },
  });
}
</script>
