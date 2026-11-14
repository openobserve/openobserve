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
  <OTag
    type="assistantContext"
    :label="agentName(agent, t)"
    :icon="agentGlyph[agent]"
    :disabled="disabled"
    class="shrink-0"
    data-test="assistant-agent-pill"
    :data-agent="agent"
  />
</template>

<script lang="ts">
import type { AgentId } from "@/composables/assistant";

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
import OTag from "@/lib/core/Badge/OTag.vue";
import { useI18nTyped } from "@/types/i18n";

withDefaults(defineProps<AssistantAgentPillProps>(), { disabled: false });

const { t } = useI18nTyped();
</script>
