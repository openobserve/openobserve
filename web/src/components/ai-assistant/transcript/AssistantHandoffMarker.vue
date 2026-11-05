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
  <div class="flex min-w-0 flex-col gap-1" data-test="assistant-handoff-marker" :data-agent="agent">
    <div class="flex min-w-0 items-center gap-2">
      <OSeparator class="min-w-4 flex-1" />
      <OIcon :name="assistantGlyph.handoff" size="xs" class="text-text-secondary shrink-0" />
      <OText variant="meta" as="p" class="min-w-0 break-words" data-test="assistant-handoff-label">
        {{ label }}
      </OText>
      <OButton
        variant="ghost"
        size="xs"
        class="shrink-0 max-md:min-h-11 pointer-coarse:min-h-11"
        :aria-expanded="open"
        :aria-controls="panelId"
        data-test="assistant-handoff-given"
        @click="open = !open"
      >
        {{ t("assistant.handoff.given") }}
      </OButton>
      <OSeparator class="min-w-4 flex-1" />
    </div>
    <div
      v-show="open"
      :id="panelId"
      class="text-text-secondary flex min-w-0 flex-col gap-0.5 px-2 text-center text-xs"
      data-test="assistant-handoff-given-panel"
    >
      <p>{{ t("assistant.handoff.givenTurns", { questions, answers }) }}</p>
      <p v-if="chips.length" data-test="assistant-handoff-context">
        {{ t("assistant.handoff.givenContext", { chips: raw(chips.join(", ")) }) }}
      </p>
      <p v-if="withdrewApproval" data-test="assistant-handoff-not-carried">
        {{
          t("assistant.handoff.notCarried", { items: t("assistant.handoff.notCarriedApproval") })
        }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId } from "vue";

import { assistantGlyph } from "@/components/ai-assistant/common/glyphs";
import { agentName, type AgentId } from "@/composables/assistant/pure";
import OButton from "@/lib/core/Button/OButton.vue";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import OSeparator from "@/lib/core/Separator/OSeparator.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { raw, useI18nTyped } from "@/types/i18n";
import { formatOrgTime } from "@/utils/formatters";

const props = withDefaults(
  defineProps<{
    agent: AgentId;
    /** When the turn that carried the hand-off was sent, epoch ms. */
    at?: number;
    questions: number;
    answers: number;
    /** The context chips the turn carried, by label. */
    chips?: string[];
    withdrewApproval?: boolean;
  }>(),
  { at: undefined, chips: () => [], withdrewApproval: false },
);

const { t } = useI18nTyped();
const open = ref(false);
const panelId = `assistant-handoff-${useId()}`;

const label = computed(() => {
  const agent = agentName(props.agent, t);
  return props.at === undefined
    ? t("assistant.handoff.markerUntimed", { agent })
    : t("assistant.handoff.marker", { agent, time: raw(formatOrgTime(props.at)) });
});
</script>
