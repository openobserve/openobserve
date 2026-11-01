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
  <span
    :class="['flex min-w-0 items-center', size === 'meta' ? 'gap-2' : 'gap-1.5']"
    :aria-label="size === 'compact' ? accessibleName : undefined"
    :role="size === 'compact' ? 'group' : undefined"
    :data-size="size"
    data-test="assistant-agent-identity"
    :data-agent="agent"
  >
    <AssistantMark :size="size === 'compact' ? 'xs' : 'sm'" :glyph="glyph" />
    <template v-if="size === 'meta'">
      <OText variant="meta" class="leading-5" data-test="assistant-agent-identity-name">
        {{ name }}
      </OText>
      <OText v-if="time" variant="meta" class="leading-5" data-test="assistant-agent-identity-time">
        {{ time }}
      </OText>
    </template>
    <span v-else-if="size === 'compact'" class="flex min-w-0 items-center gap-1.5 text-xs">
      <OTruncatedText v-if="title" class="text-text-heading min-w-0 font-medium">{{
        title
      }}</OTruncatedText>
      <slot name="status" />
      <OTooltip :content="name" />
    </span>
    <span v-else class="flex min-w-0 flex-col">
      <OTruncatedText v-if="title" class="text-text-heading min-w-0 text-sm font-medium">{{
        title
      }}</OTruncatedText>
      <span
        class="flex min-w-0 items-center gap-1 text-xs @max-[24rem]:sr-only"
        data-test="assistant-agent-identity-line"
      >
        <span class="text-text-body shrink-0" data-test="assistant-agent-identity-name">{{
          name
        }}</span>
        <template v-if="$slots.status">
          <span class="text-text-secondary shrink-0" aria-hidden="true">·</span>
          <slot name="status" />
        </template>
      </span>
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed } from "vue";

import AssistantMark from "@/components/ai-assistant/common/AssistantMark.vue";
import { agentGlyph } from "@/components/ai-assistant/common/glyphs";
import { agentName, type AgentId } from "@/composables/assistant/pure";
import OTruncatedText from "@/lib/core/Typography/OTruncatedText.vue";
import OText from "@/lib/core/Typography/OText.vue";
import OTooltip from "@/lib/overlay/Tooltip/OTooltip.vue";
import { useI18nTyped, type I18nText } from "@/types/i18n";

const props = withDefaults(
  defineProps<{
    size: "header" | "compact" | "meta";
    agent: AgentId;
    /** Optional: the existing panel header renders its own title beside this slot. */
    title?: I18nText;
    /** Meta row: the turn's own time. */
    time?: I18nText;
  }>(),
  { title: undefined, time: undefined },
);

defineSlots<{ status?: () => unknown }>();

const { t } = useI18nTyped();
const name = computed(() => agentName(props.agent, t));
const glyph = computed(() => agentGlyph[props.agent]);
const accessibleName = computed(() => [props.title, name.value].filter(Boolean).join(", "));
</script>
