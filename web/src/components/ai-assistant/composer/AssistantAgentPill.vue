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
    :class="[AGENT_PILL_CLASS, disabled && 'text-text-body!']"
    data-test="assistant-agent-pill"
    :data-agent="agent"
  >
    <OIcon
      :name="agentGlyph[agent]"
      size="xs"
      :class="['text-ai-accent', disabled && 'opacity-45']"
    />
    <span class="truncate">{{ agentName(agent, t) }}</span>
  </span>
</template>

<script lang="ts">
import type { AgentId } from "@/composables/assistant";

// The agent pill is the kit's one pill shape; repoGuards allows rounded-full only here and in the bottom row.
export const AGENT_PILL_CLASS =
  "bg-surface-subtle text-text-heading inline-flex h-7 max-w-48 min-w-0 items-center gap-1.5 rounded-full ps-1.5 pe-2 text-xs leading-none font-medium";

// OButton has no class merge, so the pill's fill and text must outrank the ghost variant's transparent ones.
export const AGENT_PICKER_CLASS =
  "bg-surface-subtle! text-text-heading! enabled:hover:bg-button-ghost-subtle-hover-bg! enabled:active:bg-button-ghost-subtle-active-bg! aria-expanded:bg-button-ghost-subtle-hover-bg! disabled:opacity-45";

export interface AssistantAgentPillProps {
  agent: AgentId;
  disabled?: boolean;
}
</script>

<script setup lang="ts">
import { agentGlyph } from "@/components/ai-assistant/common/glyphs";
import { agentName } from "@/composables/assistant/pure";
import OIcon from "@/lib/core/Icon/OIcon.vue";
import { useI18nTyped } from "@/types/i18n";

withDefaults(defineProps<AssistantAgentPillProps>(), { disabled: false });

const { t } = useI18nTyped();
</script>
