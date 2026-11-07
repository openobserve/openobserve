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
  <div
    class="flex min-w-0 flex-wrap items-start justify-between gap-3"
    data-test="agent-home-briefing"
  >
    <div class="flex min-w-0 flex-col gap-1">
      <h2 class="text-text-heading text-xl font-semibold" data-test="agent-home-headline">
        <OSkeleton v-if="pending" type="text" class="h-6 w-72" />
        <template v-else>
          <span>{{ needLine }}</span>
          <span v-if="counts.noAlert > 0" class="text-text-secondary"> · </span>
          <span v-if="counts.noAlert > 0" data-test="agent-home-headline-no-alert">{{
            noAlertLine
          }}</span>
        </template>
      </h2>
      <OText variant="meta" data-test="agent-home-briefing-note">{{ note }}</OText>
    </div>
    <OButton
      v-if="canBrief"
      variant="outline"
      size="sm"
      :icon-left="assistantGlyph.assistant"
      data-test="agent-home-brief-me"
      @click="briefMe"
    >
      {{ t("home.agent.briefMe") }}
    </OButton>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { openAssistant, type ComposerState } from "@/composables/assistant";
import OButton from "@/lib/core/Button/OButton.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OSkeleton from "@/lib/feedback/Skeleton/OSkeleton.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    counts: { needYou: number; noAlert: number };
    pending?: boolean;
    /** The page range is relative, so the list refreshes itself. */
    refreshes: boolean;
    /** Brief me is offered only while the agent can answer. */
    canBrief: boolean;
    pageRange?: ComposerState["timeOverride"];
  }>(),
  { pending: false, pageRange: null },
);

const { t } = useI18nTyped();

const needLine = computed<I18nText>(() =>
  props.counts.needYou === 0
    ? t("home.agent.headline.clear")
    : t("home.agent.headline.needYou", { count: props.counts.needYou }, props.counts.needYou),
);
const noAlertLine = computed<I18nText>(() =>
  t("home.agent.headline.noAlert", { count: props.counts.noAlert }, props.counts.noAlert),
);
const note = computed<I18nText>(() =>
  props.refreshes ? t("home.agent.briefingNoteRefresh") : t("home.agent.briefingNote"),
);

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
