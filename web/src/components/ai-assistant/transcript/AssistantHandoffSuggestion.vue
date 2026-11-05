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
    v-if="collapsed"
    class="flex min-w-0 flex-wrap items-center gap-x-2"
    data-test="assistant-handoff-suggestion-collapsed"
  >
    <OText variant="meta">{{ t("assistant.handoff.suggest.collapsed", { agent: name }) }}</OText>
    <OButton
      variant="ghost-primary"
      size="xs"
      class="max-md:min-h-11 pointer-coarse:min-h-11"
      data-test="assistant-handoff-suggestion-reopen"
      @click="emit('accept')"
    >
      {{ t("assistant.handoff.suggest.handoff") }}
    </OButton>
  </div>
  <OCard
    v-else
    variant="outlined"
    class="min-w-0 gap-2 p-3"
    data-test="assistant-handoff-suggestion"
    :data-agent="agent"
    @keydown.esc.stop.prevent="emit('dismiss')"
  >
    <div class="flex min-w-0 items-center gap-2">
      <AssistantMark size="sm" :glyph="agentGlyph[agent]" />
      <OText variant="body-strong" as="p" class="min-w-0">
        {{ agentSuggestTitle(agent, t) }}
      </OText>
    </div>
    <OText variant="meta" as="p" data-test="assistant-handoff-suggestion-body">
      {{ t(metered ? "assistant.handoff.suggest.bodyMetered" : "assistant.handoff.suggest.body") }}
    </OText>
    <div class="flex flex-wrap gap-2">
      <OButton
        variant="primary"
        size="sm"
        class="max-md:min-h-11 pointer-coarse:min-h-11"
        data-test="assistant-handoff-suggestion-accept"
        @click="emit('accept')"
      >
        {{ t("assistant.handoff.suggest.accept", { agent: name }) }}
      </OButton>
      <OButton
        variant="outline"
        size="sm"
        class="max-md:min-h-11 pointer-coarse:min-h-11"
        data-test="assistant-handoff-suggestion-dismiss"
        @click="emit('dismiss')"
      >
        {{ t("assistant.handoff.suggest.dismiss") }}
      </OButton>
    </div>
  </OCard>
</template>

<script setup lang="ts">
import { computed } from "vue";

import AssistantMark from "@/components/ai-assistant/common/AssistantMark.vue";
import { agentGlyph } from "@/components/ai-assistant/common/glyphs";
import { agentName, agentSuggestTitle, type AgentId } from "@/composables/assistant/pure";
import OButton from "@/lib/core/Button/OButton.vue";
import OCard from "@/lib/core/Card/OCard.vue";
import OText from "@/lib/core/Typography/OText.vue";
import { useI18nTyped } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    agent: AgentId;
    collapsed?: boolean;
    /** Only a metered org hears about credits. */
    metered?: boolean;
  }>(),
  { collapsed: false, metered: false },
);

const emit = defineEmits<{
  (e: "accept"): void;
  (e: "dismiss"): void;
}>();

const { t } = useI18nTyped();
const name = computed(() => agentName(props.agent, t));
</script>
